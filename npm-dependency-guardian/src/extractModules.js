const acorn_walk = require('acorn-walk');

const {
  trackScope,
  trackVars,
  NodeTypes,
} = require('./astUtils.js')

require('./acornWalkPatch.js')


/**
 * Indicates whether a VariableDeclarator represents a call of the require function (which would
 * mean that a module is imported)
 * @param   {Object} declarator The VariableDeclarator
 * @returns {boolean}           true, if the declarator is coming from a require call
 */
function validRequireCall(declarator) {
  // Variable declaration is initialized from a require call with a string literal first argument,
  // assigned to an identifier (instead of e.g. object- or array-pattern)
  return (declarator.init &&
          declarator.id.type === NodeTypes.Identifier &&
          (declarator.init.type === NodeTypes.CallExpression || declarator.init.type === NodeTypes.NewExpression) &&
          declarator.init.callee.type === NodeTypes.Identifier &&
          declarator.init.callee.name === 'require' &&
          declarator.init.arguments.length > 0 &&
          declarator.init.arguments[0].type === NodeTypes.Literal &&
          typeof(declarator.init.arguments[0].value) === 'string')
}


// TODO: delete variable reference on assignment that overwrites an existing modrefvar
/**
 * Tracks variables referencing built-in modules while traversing an AST
 * @param {Object}      node The current AST node
 * @param {String}      type The type of the current node
 * @param {Environment} env  The current environment
 */
function trackModuleReferencingVars(node, type, env) {
  switch (type) {
    case NodeTypes.VariableDeclaration:
      for (const variableDeclarator of node.declarations) {
        if (validRequireCall(variableDeclarator)) {
          const envVar = env.getVarNamed(variableDeclarator.id.name);
          envVar.setModule(variableDeclarator.init.arguments[0].value)
        // Assign variable to other module referencing variable
        } else if (variableDeclarator.init &&
                   variableDeclarator.id.type === NodeTypes.Identifier &&
                   variableDeclarator.init.type === NodeTypes.Identifier) {
          const modRefVar = env.getModRefVarNamed(variableDeclarator.init.name);
          if (modRefVar !== null) {
            const envVar = env.getVarNamed(variableDeclarator.id.name);
            envVar.setModule(modRefVar.module)
          }
        }
      }
      break;
    case NodeTypes.ImportDeclaration:
      if (node.source.type === NodeTypes.Literal) {
        for (const specifier of node.specifiers) {
          if (specifier.type === NodeTypes.ImportDefaultSpecifier ||
              specifier.type === NodeTypes.ImportNamespaceSpecifier) {
            const envVar = env.getVarNamed(specifier.local.name);
            envVar.setModule(node.source.value);
          }
        }
      }
      break;
  }
}

// TODO: we're still not dealing with import expressions
// implements all possible patterns from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#syntax
// according to the acorn source, there are only the import specifier types
// `ImportDefaultSpecifier`, `ImportNamespaceSpecifier` and `ImportSpecifier` https://github.com/acornjs/acorn/blob/master/acorn-walk/src/index.js
// TODO: this only works if the imports comes from a string literal, i *believe* this is the only
// allowed way to do it (see the link above), but i'm not 100% sure.
// For the built in modules, the "ImportDefaultSpecifier" as well as the
// "ImportNamespaceSpecifier" both import the whole module as the declared variable name.
/**
 * Keeps track of the accessed module members while traversing an AST
 * @param {Object}      node           The current AST node
 * @param {String}      type           The type of the current node
 * @param {Environment} env            The current environment
 * @param {Set}         memberAccesses The set of accessed module members
 */
function trackMemberAccess(node, type, env, memberAccesses) {
  if (type === NodeTypes.ImportDeclaration && node.source.type === NodeTypes.Literal) {
    for (const specifier of node.specifiers) {
      // TODO: check whether this is the only way to instantly get member access from an import
      // declaration
      if (specifier.type === NodeTypes.ImportSpecifier) {
        memberAccesses.add(`${node.source.value}.${specifier.imported.name}`);
      }
    }
  } else if (type === NodeTypes.ExportNamedDeclaration && node.source !== null && node.source.type === NodeTypes.Literal) {
    for (const specifier of node.specifiers) {
      if (specifier.type === NodeTypes.ExportSpecifier) {
        memberAccesses.add(`${node.source.value}.${specifier.local.name}`);
      }
    }
  } else if (type === NodeTypes.ExportAllDeclaration && node.source !== null && node.source.type === NodeTypes.Literal) {
    console.error(`Re-Exporting all members of module ${node.source.value}. Can't track members!`);
  } else if (type === NodeTypes.MemberExpression) {
    // Member access to an existing module referencing var, where the accessed member is a literal
    // or an identifier
    if ((node.property.type === NodeTypes.Literal || node.property.type === NodeTypes.Identifier) &&
        node.object.type === NodeTypes.Identifier) {
      const modRefVar = env.getModRefVarNamed(node.object.name);
      if (modRefVar !== null) {
        memberAccesses.add(`${modRefVar.module}.${node.property.name || node.property.value}`)
      }
    // Member access directly to a require call
    } else if ((node.property.type === NodeTypes.Literal || node.property.type === NodeTypes.Identifier) &&
               (node.object.type === NodeTypes.CallExpression || node.object.type === NodeTypes.NewExpression) &&
               node.object.callee.type === NodeTypes.Identifier &&
               node.object.callee.name === 'require' &&
               node.object.arguments.length > 0 &&
               node.object.arguments[0].type === NodeTypes.Literal &&
               typeof(node.object.arguments[0].name) === 'string') {
      memberAccesses.add(`${node.object.arguments[0].name}.${node.property.name || node.property.value}`)
    }
  } else if (type === NodeTypes.VariableDeclaration) {
    // Array and object pattern from
    // - require
    // - module referencing variable
    for (const declarator of node.declarations) {
      if (declarator.id.type === NodeTypes.ObjectPattern) {
        // object pattern from require call
        if (declarator.init &&
            (declarator.init.type === NodeTypes.CallExpression || declarator.init.type == NodeTypes.NewExpression) &&
            declarator.init.callee.name === 'require' &&
            declarator.init.arguments.length > 0 &&
            declarator.init.arguments[0].type === NodeTypes.Literal &&
            typeof(declarator.init.arguments[0].value) === 'string') {
          for (const property of declarator.id.properties) {
            if (property.type === NodeTypes.Property) {
              memberAccesses.add(`${declarator.init.arguments[0].value}.${property.key.name}`);
            } else if (property.type === NodeTypes.RestElement) {
              // TODO: implement me, maybe?
            } else {
              throw Error(`Unknown object pattern property type ${property.type}`);
            }
          }
        // object pattern from module referencing variable
        } else if (declarator.init && declarator.init.type === NodeTypes.Identifier) {
          const modRefVar = env.getModRefVarNamed(declarator.init.name);
          if (modRefVar !== null) {
            for (const property of declarator.id.properties) {
              if (property.type === NodeTypes.Property) {
                memberAccesses.add(`${modRefVar.module}.${property.key.name}`);
              } else if (property.type === NodeTypes.RestElement) {
                // TODO: implement me, maybe?
              } else {
                throw Error(`Unknown object pattern property type ${property.type}`);
              }
            }
          }
        }
      } else if (declarator.id.type === NodeTypes.ArrayPattern) {
        // array pattern from require call
        if (declarator.init &&
            (declarator.init.type === NodeTypes.CallExpression || declarator.init.type === NodeTypes.NewExpression) &&
            declarator.init.callee.name === 'require' &&
            declarator.init.arguments.length > 0 &&
            declarator.init.arguments[0].type === NodeTypes.Literal &&
            typeof(declarator.init.arguments[0].value) === 'string') {
          for (let i = 0; i < declarator.id.elements.length; ++i) {
            memberAccesses.add(`${declarator.init.name}.${i}`);
          }
        // array pattern from module referencing variable
        } else if (declarator.init && declarator.init.type === NodeTypes.Identifier) {
          const modRefVar = env.getModRefVarNamed(declarator.init.name);
          if (modRefVar !== null) {
            for (let i = 0; i < declarator.id.elements.length; ++i) {
              memberAccesses.add(`${modRefVar.module}.${i}`);
            }
          }
        }
      }
    }
  }
}

/**
 * Get all the members of modules that are accessed in a given AST
 * Inspired by acorn-walk.ancestor
 * @param   {Object} node The AST
 * @returns {Set}         The set of accessed module members
 */
function extractMemberAccesses(node) {
  let ancestors = [];
  let env;
  const memberAccesses = new Set();
  // this needs (node, st, override) as params because that's how the acorn base walker calls the
  // function recursively
  (function c(node, st, override) {
    let type = override || node.type;
    // Build ancestor array
    let isNew = node !== ancestors[ancestors.length - 1];
    if (isNew) ancestors.push(node);
    // Track block environments for scopes
    let prev_env = env;
    env = trackScope(node, type, ancestors, env);
    trackVars(node, type, env);
    trackModuleReferencingVars(node, type, env);
    trackMemberAccess(node, type, env, memberAccesses);
    // Recursively traverse children
    acorn_walk.base[type](node, st, c);
    // Exit environment
    if (type === NodeTypes.BlockStatement) {
      env = prev_env;
    }
    // Remove from ancestors
    if (isNew) ancestors.pop();
  })(node);
  return memberAccesses;
}

// Everything above this line is member access tracing


/**
 * Get all the modules that are imported in a given AST
 * @param   {Object} ast The AST
 * @returns {Set}        Set containing the imported modules
 */
function extractImportsFromAST(ast) {
  let imports = new Set();
  acorn_walk.simple(ast, {
    NewExpression(node) {
      if (node.callee.type === NodeTypes.Identifier) {
        if (node.callee.name === 'require') {
          if (node.arguments.length >= 1 && node.arguments[0].type == 'Literal') {
            imports.add(node.arguments[0].value);
          } else {
            console.error('Called require with', node.arguments.map((node) => node.type));
          }
        }
      }
    },
    CallExpression(node) {
      if (node.callee.type === NodeTypes.Identifier) {
        if (node.callee.name === 'require') {
          if (node.arguments.length >= 1 && node.arguments[0].type == 'Literal') {
            imports.add(node.arguments[0].value);
          } else {
            console.error('Called require with', node.arguments.map((node) => node.type));
          }
        }
      }
    },
    ImportDeclaration(node) {
      if (node.source.type == 'Literal') {
        imports.add(node.source.value);
      } else {
        console.error(`Import statement with source ${node.source}`);
      }
    },
    ImportExpression(node) {
      if (node.source.type == 'Literal') {
        imports.add(node.source.value);
      } else {
        console.error(`Import expression with source ${node.source}`);
      }
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) {
        if (node.source.type === NodeTypes.Literal) {
          imports.add(node.source.value);
        } else {
          console.error(`Export statement with source ${node.source}`);
        }
      }
    },
    ExportAllDeclaration(node) {
      if (node.source.type === NodeTypes.Literal) {
        imports.add(node.source.value);
      } else {
        console.error(`Export statement with source ${node.source}`);
      }
    }
  });
  return imports;
}

module.exports = {
  extractImports: extractImportsFromAST,
  extractMemberAccesses: extractMemberAccesses,
}
