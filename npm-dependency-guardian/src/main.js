"use strict";

const path = require('path');
const fs = require('fs');
const mod = require('node:module');

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;

const { getDependencyMap } = require('./dependencyGraph.js');
const { buildTree, MemberAccess } = require('./astUtils');
const { extractImports, extractMemberAccesses } = require('./extractModules');
const { extractGlobals } = require('./extractGlobals')
const { log } = require('./colorLog');
require('./setUtils.js'); // adds `union` and `intersection` to Set prototype


// This implies that the node version running this script, and the node version later
// executing the software are using the same node version (or one with compatible builtins)
const NATIVE_MODULES = new Set(mod.builtinModules);

let POLICY_PATH = "/tmp/node_policy.json";
let OLD_POLICY_PATH = "/tmp/node_policy.json.old";

/**
 * Indicate whether a filename has a JavaScript file extension
 * @param   {String} name The name of the file
 * @returns {boolean}     true, if the file name has a JavaScript extension, else false
 */
function isJsFileName(name) {
  return name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs');
}

/**
 * Get the Paths to all JS files within the given directory tree
 * @param   {String}   dirPath Path to the "root" directory to search in
 * @returns {String[]}         List of JS file paths
 */
function recursiveGetJSFilePaths(dirPath) {
  let jsFilePaths = new Array();
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((dirEntry) => {
    let fullPath = path.join(dirPath, dirEntry.name);
    if (dirEntry.isDirectory() && dirEntry.name.split('/').pop() != 'node_modules') {
      jsFilePaths = jsFilePaths.concat(recursiveGetJSFilePaths(fullPath));
    } else if (dirEntry.isFile() && isJsFileName(dirEntry.name)) {
      jsFilePaths.push(fullPath);
    }
  });
  return jsFilePaths;
}

/**
 * Remove the first line of a given string
 * @param   {String} text The string
 * @returns {String}      The string, with the first line removed
 */
function removeFirstLine(text) {
  return text.split('\n').splice(1).join('\n');
}

/**
 * Create an AST given the path to a JavaScript file
 * @param   {String}  filePath  Path to the JS file
 * @param   {boolean} locations true, if the AST should include source code locations
 * @returns {Object}            The resulting AST
 */
function getASTFromPath(filePath, locations) {
    let content = fs.readFileSync(filePath).toString();
    if (content.startsWith('#!')) {
      content = removeFirstLine(content);
    }
    return buildTree(content, locations);
}

/**
 * Get all modules and global objects that JavaScript files of a given package access
 * @param   {String}  packagePath          Path to the package
 * @param   {boolean} includeCustomModules true, if access to third-party modules should be tracked. Only used for evaluation
 * @param   {boolean} locations            true, if the resulting AST and thus the module objects should include source code locations
 * @returns {Object}                       Object containing the accessed modules and global objects
 */
function getAccessesForPackage(packagePath, includeCustomModules, locations) {
  let jsFilePaths = recursiveGetJSFilePaths(packagePath);
  let modules = new Set();
  let globals = new Set();
  for (const filePath of jsFilePaths) {
    const ast = getASTFromPath(filePath, locations);
    if (ast === null) {
      console.error(`Could not build tree for file ${filePath}.`);
      continue;
    }
    let fileModules = extractImports(ast);
    let { globals: fileGlobals } = extractGlobals(ast);
    modules = modules.union(fileModules);
    globals = globals.union(fileGlobals);
  }
  if (!includeCustomModules) {
    modules = modules.intersection(NATIVE_MODULES);
  }
  return { modules: modules, globals: globals };
}

/**
 * Get all members that JavaScript files of a given package access
 * @param   {String}  packagePath Path to the package
 * @param   {boolean} locations   true if the resulting AST, and thus the member access objects, should include source code locations
 * @returns {Object}              Object containing the accessed members
 */
function getMemberAccessesForPackage(packagePath, locations) {
  const jsFilePaths = recursiveGetJSFilePaths(packagePath);
  let moduleMemberAccesses = new Set();
  let globalMemberAccesses = new Set();
  for (const filePath of jsFilePaths) {
    const ast = getASTFromPath(filePath, locations);
    if (ast === null) {
      console.error(`Could not build tree for file ${filePath}.`);
      continue;
    }
    let fileModuleMemberAccesses = extractMemberAccesses(ast);
    let { globalMembers: fileGlobalMemberAccesses } = extractGlobals(ast);
    moduleMemberAccesses = moduleMemberAccesses.union(fileModuleMemberAccesses);
    globalMemberAccesses = globalMemberAccesses.union(fileGlobalMemberAccesses);
  };
  moduleMemberAccesses = moduleMemberAccesses
    .map((memberAccessString) => MemberAccess.fromString(memberAccessString))
    .filter((memberAccess) => NATIVE_MODULES.has(memberAccess.module))
    .map((memberAccess) => memberAccess.toString());
  return { moduleMemberAccesses: moduleMemberAccesses, globalMemberAccesses: globalMemberAccesses };
}

/**
 * Get all capabilities from a given dependency map (mapping package paths to a list of their
 * dependencies)
 * @param   {Object}  dependencyMap        The dependency map
 * @param   {boolean} memberAccessTracing  true if memberAccessTracing is used
 * @param   {boolean} includeCustomModules true, if custom modules should be tracked
 * @param   {boolean} locations            true, if the AST should include source code locations
 * @returns {Object}                       The resulting capabilities
 */
function getCapabilitiesFromDependencyMap(dependencyMap, memberAccessTracing, includeCustomModules, locations) {
  const capabilitiesCoarse = {};
  const capabilitiesFine = {};

  for (const packagePath of Object.keys(dependencyMap)) {
    const { modules, globals } = getAccessesForPackage(packagePath, includeCustomModules, locations);
    capabilitiesCoarse[packagePath] = { modules: modules, globals: globals };

    if (memberAccessTracing === true) {
      const { moduleMemberAccesses, globalMemberAccesses } = getMemberAccessesForPackage(packagePath, locations);
      capabilitiesFine[packagePath] = { modules: moduleMemberAccesses, globals: globalMemberAccesses };
    }
  }

  return { capabilitiesCoarse: capabilitiesCoarse, capabilitiesFine: capabilitiesFine };
}

/**
 * Create the inner actual policy for a specific granularity, based on the given capabilities
 * @param   {Object}   capabilities        Object mapping package paths to their capabilities
 * @param   {String}   rootPath            Path to the root package
 * @param   {String}   rootPackageName     Name of the root package
 * @returns {Object}                       The resulting policy
 */
function createGranularPolicy(capabilities, rootPath, rootPackageName) {
  const policy = {};
  for (const packagePath of Object.keys(capabilities)) {
    const pathParts = packagePath.split('node_modules/');
    let packageName = pathParts[pathParts.length - 1];
    if (packageName === rootPath) {
      packageName = rootPackageName;
    }
    // If there are multiple versions of the same package in the policy, create the union
    if (Object.keys(policy).includes(packageName)) {
      const globalUnion = Array.from(new Set(policy[packageName]['globals']).union(capabilities[packagePath]['globals'])).sort();
      const moduleUnion = Array.from(new Set(policy[packageName]['modules']).union(capabilities[packagePath]['modules'])).sort();
      policy[packageName] = { modules: moduleUnion, globals: globalUnion };
    } else {
      const globalArray = Array.from(capabilities[packagePath]['globals']).sort();
      const moduleArray = Array.from(capabilities[packagePath]['modules']).sort();
      policy[packageName] = { modules: moduleArray, globals: globalArray };
    }
  };
  return policy;
}

/**
 * Create a well formatted policy from the extracted capabilities
 * @param   {Object}   capabilities        Object containing `capabilitiesCoarse` and `capabilitiesFine` which are mapping package paths to their capabilities
 * @param   {String}   rootPath            Path to the root package
 * @param   {String}   rootPackageName     Name of the root package
 * @param   {boolean?} memberAccessTracing true if memberAccessTracing is used, else false or null or undefined
 * @returns {Object}                       The resulting policy
 */
function createPolicy(capabilities, rootPath, rootPackageName, memberAccessTracing) {
  const { capabilitiesCoarse, capabilitiesFine } = capabilities;
  const policyCoarse = createGranularPolicy(capabilitiesCoarse, rootPath, rootPackageName);
  const policyFine = createGranularPolicy(capabilitiesFine, rootPath, rootPackageName);
  const surrounding = {
    // Because memberAccessTracing is created by yargs and may be null or undefined
    memberAccessTracing: memberAccessTracing === true,
    policyCoarse: policyCoarse,
    policyFine: policyFine
  }
  return surrounding;
}

/**
 * Load the current policy from the POLICY PATH
 * @returns {Object} The policy
 */
function readPolicy() {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(POLICY_PATH).toString());
  } catch (e) {
    policy = {memberAccessTracing: false, policy: {}};
  }
  return policy;
}

/**
 * Print out which new members are accessed (for policies with member tracing)
 * @param {Object} oldPolicy The old policy
 * @param {Object} newPolicy The new policy
 */
function compareMemberAccessPolicies(oldPolicy, newPolicy) {
  const newUses = policyDiff(oldPolicy, newPolicy);
  if (Object.keys(newUses).length > 0) {
    for (const pkg of Object.keys(newUses)) {
      for (const moduleAccess of newUses[pkg]['modules']){
        log(`Package ${pkg} now accesses previously unaccessed module member ${moduleAccess}.`,
            'brightRed');
      }
      for (const globalAccess of newUses[pkg]['globals']) {
        log(`Package ${pkg} now accesses previously unaccessed global member ${globalAccess}.`,
            'brightRed');
      }
    }
  } else {
    log('No new member accesses detected!', 'brightGreen');
  }
}

/**
 * Print out which new modules and global objects are accessed (for policies without member tracing)
 * @param {Object} oldPolicy The old policy
 * @param {Object} newPolicy The new policy
 */
function compareImportPolicies(oldPolicy, newPolicy) {
  const newUses = policyDiff(oldPolicy, newPolicy);
  if (Object.keys(newUses).length > 0) {
    for (const pkg of Object.keys(newUses)) {
      for (const module of newUses[pkg]['modules']) {
        log(`Package ${pkg} now imports previously not imported module ${module}.`, 'brightRed');
      }
      for (const global of newUses[pkg]['globals']) {
        log(`Package ${pkg} now uses previously unused global ${global}.`, 'brightRed');
      }
    }
  } else {
    log('No new imports detected!', 'brightGreen');
  }
}

/**
 * Create the difference between the new policy and the old policy
 * @param   {Object} oldPolicy The old policy
 * @param   {Object} newPolicy The new policy
 * @returns {Object}           Elements present in the new policy, but not in the old policy
 */
function policyDiff(oldPolicy, newPolicy) {
  const newUses = {};
  oldPolicy = oldPolicy || {};
  for (const packagePath of Object.keys(newPolicy)) {
    const {
      modules: allowedModules,
      globals: allowedGlobals
    } = oldPolicy[packagePath] || {modules: [], globals: []};
    for (const newGlobal of newPolicy[packagePath]['globals']) {
      if (!allowedGlobals.includes(newGlobal)) {
        if (!(packagePath in newUses)) {
          newUses[packagePath] = {globals: [], modules: []};
        }
        newUses[packagePath]['globals'].push(newGlobal);
      }
    }
    for (const newModule of newPolicy[packagePath]['modules']) {
      if (!allowedModules.includes(newModule)) {
        if (!(packagePath in newUses)) {
          newUses[packagePath] = {globals: [], modules: []};
        }
        newUses[packagePath]['modules'].push(newModule);
      }
    }
  }
  return newUses;
}

/**
 * Merges the new policy with an old policy
 * @param   {Object} oldPolicy The old policy
 * @param   {Object} newPolicy The new policy
 * @returns {Object}           The merged policy
 */
function mergePolicies(oldPolicy, newPolicy) {
  return Object.assign({}, oldPolicy, newPolicy);
}

/**
 * Save the policy, and potentially create a backup of the old one
 * @param {Object}  newPolicy The newly created policy
 * @param {Object}  oldPolicy The old policy
 * @param {boolean} noBackup  true if a backup should be omitted, else false
 */
function savePolicy(newPolicy, oldPolicy, noBackup) {
  fs.writeFileSync(POLICY_PATH, JSON.stringify(newPolicy));
  if (!noBackup) {
    fs.writeFileSync(OLD_POLICY_PATH, JSON.stringify(oldPolicy));
  }
}

function main() {
  const inPath = argv._[0] || "";
  if (inPath === "" || argv.h) {
    console.log('Usage: node src/main.js PATH [--overwrite --locations --member-access-tracing --no-backup --custom-modules --json --policy-path PATH]');
    process.exit(1);
  }
  if (argv.policyPath) {
    POLICY_PATH = argv.policyPath;
    OLD_POLICY_PATH = argv.policyPath + '.old';
  }
  const rootPath = path.resolve(inPath);
  const dependencyMap = getDependencyMap(rootPath);
  const rootPackageName = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'))).name;
  const capabilities = getCapabilitiesFromDependencyMap(dependencyMap, argv.memberAccessTracing, argv.customModules, argv.locations);
  const newPolicy = createPolicy(capabilities, rootPath, rootPackageName, argv.memberAccessTracing);
  const oldPolicy = readPolicy();
  let mergedPolicy;
  if (!argv.json) {
    compareImportPolicies(oldPolicy.policyCoarse, newPolicy.policyCoarse);
    if (argv.memberAccessTracing) {
      compareMemberAccessPolicies(oldPolicy.policyFine, newPolicy.policyFine);
    }
  }
  if (argv.json || argv.overwrite) {
    // Should policies be merged?
    // mergedPolicy = mergePolicies(oldPolicy, newPolicy);
    mergedPolicy = newPolicy;
  }
  if (argv.json) {
    console.log(JSON.stringify(mergedPolicy, null, 2));
  }
  if (argv.overwrite) {
    savePolicy(mergedPolicy, oldPolicy, argv.noBackup);
    if (!argv.json) {
      console.log(`New policy written to ${POLICY_PATH}, backed up previous policy to ${OLD_POLICY_PATH}.`);
    }
  } else if (!argv.json) {
    console.log('No policy written.');
  }
}

main()
