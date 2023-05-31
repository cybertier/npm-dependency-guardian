const acorn = require('acorn');

/**
 * "Enum" for the different types of AST nodes available in acorn that are used in this module
 */
const NodeTypes = {
  ArrayPattern: 'ArrayPattern',
  ArrowFunctionExpression: 'ArrowFunctionExpression',
  AssignmentExpression: 'AssignmentExpression',
  AssignmentPattern: 'AssignmentPattern',
  BlockStatement: 'BlockStatement',
  CallExpression: 'CallExpression',
  ExportAllDeclaration: 'ExportAllDeclaration',
  ExportNamedDeclaration: 'ExportNamedDeclaration',
  ExportSpecifier: 'ExportSpecifier',
  Function: 'Function',
  FunctionDeclaration: 'FunctionDeclaration',
  FunctionExpression: 'FunctionExpression',
  Identifier: 'Identifier',
  ImportDeclaration: 'ImportDeclaration',
  ImportDefaultSpecifier: 'ImportDefaultSpecifier',
  ImportExpression: 'ImportExpression',
  ImportNamespaceSpecifier: 'ImportNamespaceSpecifier',
  ImportSpecifier: 'ImportSpecifier',
  Literal: 'Literal',
  MemberExpression: 'MemberExpression',
  MethodDefinition: 'MethodDefinition',
  NewExpression: 'NewExpression',
  ObjectPattern: 'ObjectPattern',
  Program: 'Program',
  Property: 'Property',
  RestElement: 'RestElement',
  SequenceExpression: 'SequenceExpression',
  UpdateExpression: 'UpdateExpression',
  UnaryExpression: 'UnaryExpression',
  VariableDeclaration: 'VariableDeclaration',
  VariableDeclarator: 'VariableDeclarator',
}


/**
 * "Enum" for the different types of Environments that are available.
 * This represents the different types of scopes available in JavaScript
 */
const EnvironmentTypes = {
  Program: 'Program',
  Function: 'Function',
  Method: 'Method',
  Block: 'Block'
};


/**
 * Class that tracks environments/scopes during AST traversal
 */
class Environment {
  constructor(type, start, end, parent, initial_vars) {
    this.type = type;
    this.start = start;
    this.end = end;
    this.parent = parent;
    this.vars = initial_vars || new Array();
    this.children = new Array();
  }

  /**
   * Add a new environment to the list of child environments
   * @param {Environment} child The child environment to add
   */
  addChild(child) {
    this.children.push(child);
  }

  /**
   * Add a new variable to the current environment
   * @param {Variable} variable The variable to add
   */
  addVar(variable) {
    this.vars.push(variable);
  }

  /**
   * Add a new variable to the closest surrounding function scope
   * @param {Variable} variable The varialbe to add
   */
  addVarToFunctionScope(variable) {
    let env = this;
    while ((env.type !== EnvironmentTypes.Function &&
            env.type !== EnvironmentTypes.Method) &&
           env.parent !== null) {
      env = env.parent;
    }
    env.vars.push(variable);
  }

  /**
   * Get a list of all variables available in the current environment
   * @returns {Variable[]} List of variables available in the current environment
   */
  allVars() {
    return this.parent === null ? this.vars : this.vars.concat(this.parent.allVars());
  }

  /**
   * Get a module referencing variable that has a given name within the environment
   * @param   {String}    name The name of the variable to get
   * @returns {Variable?}      The variable, if it exists, else null
   */
  getModRefVarNamed(name) {
    const variable = this.getVarNamed(name);
    if (variable === null) {
      return null;
    }
    return variable.module === null ? null : variable;
  }

  /**
   * Get a variable of a given name within the environment
   * @param   {String}    name The name of the variable to get
   * @returns {Variable?}      The variable of that name, if it exists, else null
   */
  getVarNamed(name) {
    for (const variable of this.vars) {
      if (variable.name === name) {
        return variable;
      }
    }
    return this.parent === null ? null : this.parent.getVarNamed(name);
  }

  /**
   * Indicates whether there is a variable with a given name in this environment
   * @param   {String}  name The name of the variable to look for
   * @returns {boolean}      true if a variable of the given name exists, else false
   */
  hasVarNamed(name) {
    return this.getVarNamed(name) !== null;
  }
}


/**
 * Class representing access to a member of a module
 */
class MemberAccess {
  /**
   * @param {String} module     The module whose member is accessed
   * @param {String} memberName The name of the member that is accessed
   */
  constructor(module, memberName) {
    this.module = module;
    this.memberName = memberName;
  }

  /**
   * Create a MemberAccess instance from a string in the form "module.property"
   * @param   {String}       accessString The string that the member access is created from
   * @returns {MemberAccess}              The resulting MemberAccess instance
   */
  static fromString(accessString) {
    const splits = accessString.split('.');
    const mod = splits.splice(0, splits.length - 1).join('.');
    const member = splits[splits.length - 1];
    return new MemberAccess(mod, member);
  }

  /**
   * Create a string for this member access in the form "module.property"
   * @returns {String} the member access string
   */
  toString() {
    return `${this.module}.${this.memberName}`
  }
}


/**
 * Represents a local variable inside an Environment
 */
class Variable {
  /**
   * @param {String}  variableName Name of the variable
   * @param {String?} module       Name of the module that the variable is referencing, if any, else null
   */
  constructor(variableName, module = null) {
    this.name = variableName;
    this.module = module; // May be null
  }

  /**
   * Make this variable a module referencing variable, referencing the given module
   * @param {String} module The module the variable is referencing
   */
  setModule(module) {
    this.module = module;
  }

  /**
   * Check whether this variable is referencing a module
   * @returns {boolean} true if the variable is referencing a module, else false
   */
  moduleReferencing() {
    return this.module !== null;
  }
}


/**
 * Check whether a given node BlockStatement node marks the beginning of a function body
 * @param   {Object[]} ancestors List of the BlockStatements ancestors
 * @returns {boolean}            true if the BlockStatement is the beginning of a function body, else false
 */
function isFunction(ancestors) {
  return (ancestors.length >= 2 &&
    (ancestors[ancestors.length - 2].type === NodeTypes.FunctionDeclaration ||
      ancestors[ancestors.length - 2].type === NodeTypes.Function ||
      ancestors[ancestors.length - 2].type === NodeTypes.FunctionExpression ||
      ancestors[ancestors.length - 2].type === NodeTypes.ArrowFunctionExpression))
}


/**
 * Check whether a given node BlockStatement node marks the beginning of a method body
 * @param   {Object[]} ancestors List of the BlockStatements ancestors
 * @returns {boolean}            true if the BlockStatement is the beginning of a method body, else false
 */
function isMethod(ancestors) {
  return (ancestors.length >= 3 &&
    ancestors[ancestors.length - 3].type === NodeTypes.MethodDefinition);
}


/**
 * Get all the identifiers that are created for a given AST node
 * @param   {Object}   node The AST node
 * @returns {String[]}      The resulting identifiers
 */
function identifiersFromNode(node) {
  const identifiers = [];
  switch (node.type) {
    case NodeTypes.Identifier:
      return [node];
    case NodeTypes.RestElement:
      return identifiersFromNode(node.argument).flat();
    case NodeTypes.AssignmentPattern:
      return identifiersFromNode(node.left).flat();
    case NodeTypes.ObjectPattern:
      for (const prop of node.properties) {
        identifiers.push(identifiersFromNode(prop));
      }
      return identifiers.flat();
    case NodeTypes.ArrayPattern:
      for (const element of node.elements) {
        // something like let [, a] = b; is valid
        if (element !== null) {
          identifiers.push(identifiersFromNode(element));
        }
      }
      return identifiers.flat();
    case NodeTypes.Property:
      return identifiersFromNode(node.value).flat();
    case NodeTypes.UpdateExpression:
    case NodeTypes.UnaryExpression:
      return identifiersFromNode(node.argument).flat();
  }
  throw Error(`Unknown node type: ${node.type}`);
}


/**
 * Get all the variable names that are created during a single import declaration
 * @param   {Object}   node The ImportDeclaration node
 * @returns {String[]}      List of resulting identifiers
 */
function identifiersFromImportDeclaration(node) {
  return node.specifiers.map((spec) => spec.local);
}

// Implementing all possible patterns according to MDN
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let
/**
 * Get all the variable names that are created during a single variable declaration
 * @param   {Object}   node The VariableDeclaration node
 * @returns {String[]}      List of resulting identifiers
 */
function identifiersFromVariableDeclaration(node) {
  const variables = [];
  for (const declarator of node.declarations) {
    variables.push(identifiersFromNode(declarator.id));
  }
  return variables.flat();
}

/**
 * Track variables that are in scope across AST nodes
 * @param   {Object}      node      The current AST node
 * @param   {String}      type      The type of the AST node
 * @param   {Environment} env       Current environment holding the known variables
 * @returns {Environment}           The resulting environment
 */
function trackVars(node, type, env) {
  switch (type) {
    case NodeTypes.ImportDeclaration:
      // Import and export may only appear at the top level, according to the AST explorer, so this
      // is always a kind of "global scope".
      for (const identifier of identifiersFromImportDeclaration(node)) {
        env.addVar(new Variable(identifier.name));
      }
      break;
    // const and let are block-scoped, var is function scoped
    case NodeTypes.VariableDeclaration:
      if (node.kind === 'var') {
        for (const identifier of identifiersFromVariableDeclaration(node)) {
          env.addVarToFunctionScope(new Variable(identifier.name));
        }
      } else {
        for (const identifier of identifiersFromVariableDeclaration(node)) {
          env.addVar(new Variable(identifier.name));
        }
      }
      break;
    // TODO: this should also look at assignment expressions, and if there is no variable in any of
    // the surrounding envs with the given name, that variable should also be added! (because unless
    // we're in "use strict;" we can create variables without cont/let/var)
  }
  // As we don't reassign env, this may be redundant
  return env;
}

/**
 * Creates variables for the parameters of a function node
 * @param   {Object[]}   ancestors List of ancestor nodes
 * @returns {Variable[]}           List of resulting variables
 */
function initialVarsForFunction(ancestors) {
  return ancestors[ancestors.length - 2].params.map(identifiersFromNode).flat().map(
    (identifier) => new Variable(identifier.name)
  );
}


/**
 * Track scope changes during the AST traversal
 * @param   {Object}      node      The current AST node
 * @param   {String}      type      The type of the AST node
 * @param   {Object[]}    ancestors List of ancestor nodes
 * @param   {Environment} env       Current environment holding the known variables
 * @returns {Environment}           The resulting environment
 */
function trackScope(node, type, ancestors, env) {
  switch (type) {
    case NodeTypes.Program:
      env = new Environment(EnvironmentTypes.Program, node.start, node.end, null);
      break;
    case NodeTypes.BlockStatement:
      // FIXME: tracing of class attributes (accessible via this.) does not work
      // Determine whether within a function or method
      let env_type;
      let initial_vars;
      if (isFunction(ancestors)) {
        initial_vars = initialVarsForFunction(ancestors);
        env_type = EnvironmentTypes.Function;
      } else if (isMethod(ancestors)) {
        initial_vars = initialVarsForFunction(ancestors);
        env_type = EnvironmentTypes.Method;
      } else {
        env_type = EnvironmentTypes.Block;
      }
      let new_env = new Environment(env_type, node.start, node.end, env, initial_vars);
      env.addChild(new_env);
      env = new_env;
      break;
  }
  return env;
}


/**
 * Build an AST from source code
 * @param   {String}  content   The source code to build the AST from
 * @param   {boolean} locations Whether the AST nodes should include source code locations
 * @returns {Object?}           The AST, or `null` if parsing failed
 */
function buildTree(content, locations = false) {
  let tree = null;
  // TODO: is it valid to always assume module source type?
  // From the v8 ES Module docs at https://v8.dev/features/modules :
  // > Because of these differences, the same JavaScript code might behave differently when treated
  // > as a module vs. a classic script. As such, the JavaScript runtime needs to know which scripts
  // > are modules
  // Looking at the page, it seems like the only thing that will break if we assume module is html
  // style comments
  let acorn_opts = { ecmaVersion: 2020, sourceType: 'module', locations: locations }
  try {
    tree = acorn.parse(content, acorn_opts);
  } catch {
    return null;
  }
  return tree;
}


module.exports = {
  buildTree: buildTree,
  identifiersFromNode: identifiersFromNode,
  isFunction: isFunction,
  isMethod: isMethod,
  trackScope: trackScope,
  trackVars: trackVars,
  Environment: Environment,
  EnvironmentTypes: EnvironmentTypes,
  NodeTypes: NodeTypes,
  MemberAccess: MemberAccess,
  Variable: Variable
};
