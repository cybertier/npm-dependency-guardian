"use strict";

const acorn_walk = require('acorn-walk');

const globalNames = require('./globalNames.js')
const {
  trackScope,
  trackVars,
  NodeTypes,
} = require('./astUtils.js')
require('./acornWalkPatch.js')


/**
 * Class representing an identifier, used to track global object access
 */
class Identifier {
  /**
   * @param {String}  name  The name of the identifier
   * @param {number?} start Start position of the identifier within the source code
   * @param {number?} end   End position of the identifier within the source code
   */
  constructor(name, start, end) {
    this.name = name;
    this.start = start;
    this.end = end;
  }
}


// TODO: add class declarations
// TODO: this whole thing could be "optimized" to basically return one large boolean expression, but
// do we want that?
/**
 * Checks whether the given identifier node references an object that is in the current scope
 * @param   {Object}   node      The node to check
 * @param   {Object[]} ancestors List of AST ancestor nodes
 * @returns {boolean}            true if the given identifier referencens an object in the current scope, else false
 */
function inGlobalNamespace(node, ancestors) {
  // Has to be in global namespace if there is no parent
  if (ancestors.length < 2) return true;
  let parent = ancestors[ancestors.length - 2];
  // Part of member expression
  if (parent.type == NodeTypes.MemberExpression && parent.property === node) {
    return false;
  }
  // Argument to a function / method
  if ((parent.type === NodeTypes.Function ||
    parent.type === NodeTypes.FunctionExpression ||
    parent.type === NodeTypes.FunctionDeclaration) &&
    parent.params.includes(node)) {
    return false;
  }
  // Name of method definition
  if (parent.type === NodeTypes.MethodDefinition && parent.key === node) {
    return false;
  }
  // Name of function definition
  if (parent.type === NodeTypes.FunctionDeclaration && parent.id === node) {
    return false;
  }
  // Name of variable declaration
  if (parent.type === NodeTypes.VariableDeclarator && parent.id === node) {
    return false;
  }
  if (ancestors.length < 3) return true;
  // Name of variable declaration in an array pattern
  if (parent.type === NodeTypes.ArrayPattern &&
      parent.elements.includes(node)) {
    return false;
  }
  let grandParent = ancestors[ancestors.length - 3];
  // Name of variable declaration in an object pattern
  if (parent.type === NodeTypes.Property &&
      grandParent.type === NodeTypes.ObjectPattern &&
      grandParent.properties.includes(parent)) {
    return false;
  }
  return true;
}


/**
 * Indicate whether an identifier represents a global object
 * @param   {Object}      node      The identifier node to check
 * @param   {Environment} env       The current environment
 * @param   {Object[]}    ancestors List of AST ancestor nodes
 * @returns {boolean}               true if the given identifier represents a global object, else false
 */
function isGlobal(node, env, ancestors) {
  return (node.type == NodeTypes.Identifier &&
          globalNames.has(node.name) &&
          !env.hasVarNamed(node.name) &&
          inGlobalNamespace(node, ancestors))
}


/**
 * Track which global objects are acessed
 * @param {Object}      node          The current node of the AST
 * @param {String}      type          The type of the current node
 * @param {Environment} env           The current environment during the AST traversal
 * @param {Object[]}    ancestors     List of AST ancestor nodes
 * @param {Set}         globalMembers Set containing all accessed global members
 */
function trackGlobals(node, type, env, ancestors, globals) {
    // Record globals
    if (type === NodeTypes.Identifier) {
      if (isGlobal(node, env, ancestors)) {
        globals.push(new Identifier(node.name, node.start, node.end));
      }
    }
}


// TODO: i currently do not differentiate between indexing into an array module, and accessing an
// object property.
// In theory i can tell by looking at the type of the module, but not sure if i want that (doesn't
// matter too much though, it's just perf)
/**
 * Track which members of global objects are accessed
 * @param {Object}      node          The current node of the AST
 * @param {String}      type          The type of the current node
 * @param {Environment} env           The current environment during the AST traversal
 * @param {Set}         globalMembers Set containing all accessed global members
 */
function trackGlobalMembers(node, type, env, ancestors, globalMembers) {
    if (type === NodeTypes.MemberExpression) {
      // If the property is not a literal, nor an identifier, we can't statically tell which
      // property is accessed.
      if ((node.property.type === NodeTypes.Identifier ||
           node.property.type === NodeTypes.Literal) &&
          isGlobal(node.object, env, ancestors.concat(node.object))) {
        globalMembers.add(`${node.object.name}.${node.property.name || node.property.value.toString()}`)
      }
    } else if (type === NodeTypes.VariableDeclaration) {
      for (const declarator of node.declarations) {
        // TODO: we can't really deal with the `...rest` RestElements
        if (declarator.id.type === NodeTypes.ObjectPattern &&
            declarator.init &&
            isGlobal(declarator.init, env, ancestors.concat([declarator, declarator.init]))) {
          for (const property of declarator.id.properties) {
            if (property.type === NodeTypes.Property) {
              globalMembers.add(`${declarator.init.name}.${property.key.name}`);
            } else if (property.type === NodeTypes.RestElement) {
              // TODO: implement me, maybe?
            } else {
              throw Error(`Unknown object pattern property type ${property.type}`);
            }
          }
        } else if (declarator.id.type === NodeTypes.ArrayPattern &&
                   declarator.init &&
                   isGlobal(declarator.init, env, ancestors.concat([declarator, declarator.init]))) {
          // TODO: when i want to add support for the rest element, this has to check whether the
          // last element is a rest element and then act accordingly
          for (let i = 0; i < declarator.id.elements.length; ++i) {
            if (declarator.id.elements[i] !== null) {
              globalMembers.add(`${declarator.init.name}.${i}`);
            }
          }
        }
      }
    }
}


/**
 * Get lists of all accesses global objects, and their respective members, for a given AST
 * @param   {Object} node     The root node of the AST
 * @param   {Object} state    Additional state for the AST traversal
 * @param   {String} override Override for the type of the root node
 * @returns {Object}          Object containing a list of the accessed global objects and their members
 */
function findGlobalsInAST(node, state, override) {
  let globals = [];
  let globalMembers = new Set();
  let ancestors = [];
  let env;
  (function c(node, st, override) {
    let type = override || node.type;
    // Build ancestor array
    let isNew = node !== ancestors[ancestors.length - 1];
    if (isNew) ancestors.push(node);
    // Track scope
    let prev_env = env;
    env = trackScope(node, type, ancestors, env);

    // Track globals and members
    trackVars(node, type, env);
    trackGlobals(node, type, env, ancestors, globals);
    trackGlobalMembers(node, type, env, ancestors, globalMembers);

    // Walk children
    acorn_walk.base[type](node, st, c);

    // Return to previous environment / scope
    if (type === NodeTypes.BlockStatement) env = prev_env;
    // Remove self from ancestors
    if (isNew) ancestors.pop();
  })(node, state, override);
  // I *want* to keep the implementation of the list with the identifiers, because i need that for
  // the interpreter implementation, however the policy only needs a set of the modules itself.
  const globalsSet = new Set(globals.map((identifier) => identifier.name));
  return {globals: globalsSet, globalMembers: globalMembers};
}


module.exports = {
  extractGlobals: findGlobalsInAST
};
