const path = require('path');
const fs = require('fs');

/**
 * Class representing nodes in the dependency graph
 */
class Node {
  /**
   * @param {String} path The path to the package this node represents
   */
  constructor(path) {
    this.path = path;
    this.dependencies = new Array();
  }

  /**
   * Add a dependency to the current node
   * @param {Node} dependency The dependency to add
   */
  addDependency(dependency) {
    this.dependencies.push(dependency);
  }
}

/**
 * Build a map from packages to their paths from version 1 lockfiles
 * @param   {Object} lockfile        The parsed lockfile
 * @param   {String} nodeModulesPath Path to the node modules directory
 * @returns {Object}                 Package paths map
 */
function buildPackagePathsMapVersion1(lockfile, nodeModulesPath) {
  const packagePathsMap = {};

  function addPackagePathsToMap(packages, nodeModulesPath) {
    for (const packageName of Object.keys(packages)) {
      const packagePath = path.join(nodeModulesPath, packageName);
      if (!Object.keys(packagePathsMap).includes(packageName)) {
        packagePathsMap[packageName] = [];
      }
      if (packages[packageName].optional === true && !fs.existsSync(packagePath)) {
        continue;
      }
      packagePathsMap[packageName].push(packagePath);
      addPackagePathsToMap(packages[packageName].dependencies || {}, path.join(nodeModulesPath, packageName, 'node_modules/'));
    }
  }

  addPackagePathsToMap(lockfile.dependencies, nodeModulesPath);
  return packagePathsMap;
}

/**
 * Create a dependency map from a lockfile with lockfile version 1
 * @param   {Object} lockfile    The parsed lockfile contents
 * @param   {Object} packageJson The packages' parsed package json file
 * @param   {String} rootPath    Path to the package root
 * @returns {Object}             The dependency map
 *
 */
function dependencyMapFromLockfileVersion1(lockfile, packageJson, rootPath) {
  const dependencyMap = {};
  const nodeModulesPath = path.join(rootPath, 'node_modules/');
  const packagePathsMap = buildPackagePathsMapVersion1(lockfile, nodeModulesPath);
  const packages = lockfile.dependencies;

  dependencyMap[rootPath] = [];
  for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
    dependencyMap[rootPath] = dependencyMap[rootPath].concat(packagePathsMap[dependencyName]);
  }

  function addDependenciesToMap(packages, nodeModulesPath) {
    for (const packageName of Object.keys(packages)) {
      const packagePath = path.join(nodeModulesPath, packageName);
      if (packages[packageName].optional && !fs.existsSync(packagePath)) {
        continue;
      }
      dependencyMap[packagePath] = [];
      const dependencies = packages[packageName].requires || {};
      for (const dependencyName of Object.keys(dependencies)) {
        dependencyMap[packagePath] = dependencyMap[packagePath].concat(packagePathsMap[dependencyName]);
      }
      addDependenciesToMap(packages[packageName].dependencies || {}, path.join(nodeModulesPath, packageName, 'node_modules/'));
    }
  }

  addDependenciesToMap(packages, nodeModulesPath)
  return dependencyMap;
}

/**
 * Create a dependency map from a lockfile with lockfile version 1
 * @param   {Object} lockfile The parsed lockfile contents
 * @param   {String} rootPath Path to the package root
 * @returns {Object}          The dependency map
 *
 */
function buildPackagePathsMapVersion2or3(lockfile, rootPath) {
  const packagePathsMap = {};
  const packages = lockfile.packages;
  for (const relativePackagePath of Object.keys(packages)) {
    const packagePath = path.join(rootPath, relativePackagePath);
    const pathParts = packagePath.split('node_modules/');
    const packageName = pathParts[pathParts.length - 1];
    if (!Object.keys(packagePathsMap).includes(packageName)) {
      packagePathsMap[packageName] = [];
    }
    // This has two usecases
    // - package is optional and was not installed
    // - packages does not exist for mysterious reasons (e.g. for the
    // `@aguycalled/bitcore-message@1.0.4` the transitive dependency `bindings` of
    // `@aguycalled/bitcore-lib`)
    if (!fs.existsSync(packagePath)) {
      continue;
    }
    packagePathsMap[packageName].push(packagePath);
  }
  return packagePathsMap;
}

/**
 * Create a dependency map from a lockfile with lockfile version 2 or 3
 * @param   {Object} lockfile The parsed lockfile contents
 * @param   {String} rootPath Path to the package root
 * @returns {Object}          The dependency map
 *
 */
function dependencyMapFromLockfileVersion2or3(lockfile, rootPath) {
  const dependencyMap = {};

  const packagePathsMap = buildPackagePathsMapVersion2or3(lockfile, rootPath);

  const packages = lockfile.packages;
  for (const relativePackagePath of Object.keys(packages)) {
    const packagePath = path.join(rootPath, relativePackagePath);
    // This has two usecases
    // - package is optional and was not installed
    // - packages does not exist for mysterious reasons (e.g. for the
    // `@aguycalled/bitcore-message@1.0.4` the transitive dependency `bindings` of
    // `@aguycalled/bitcore-lib`)
    if (!fs.existsSync(packagePath)) {
      continue;
    }
    dependencyMap[packagePath] = [];
    const dependencies = packages[relativePackagePath].dependencies || {};
    for (const dependencyName of Object.keys(dependencies)) {
      // Apparently `npm install` does *not* guarantee that all packages listed in the dependencies
      // section are actually installed, thus we have to check whether a dependency was actually
      // installed.
      // Example: the `goose-frontend` package does not install its `styled-components` dependency,
      // `npm list` even complains about that!
      if (packagePathsMap.hasOwnProperty(dependencyName)){
        dependencyMap[packagePath] = dependencyMap[packagePath].concat(packagePathsMap[dependencyName]);
      }
    }
  }
  return dependencyMap;
}

/**
 * Parse the lockfile of a given packages' root directory.
 * @param   {String} rootPath The path to the package
 * @returns {Object}          The parsed lockfile
 */
function parseLockfile(rootPath) {
  const npmShrinkwrapPath = path.join(rootPath, 'npm-shrinkwrap.json');
  if (fs.existsSync(npmShrinkwrapPath)) {
    return JSON.parse(fs.readFileSync(npmShrinkwrapPath));
  }
  const packageLockJsonPath = path.join(rootPath, 'package-lock.json');
  return JSON.parse(fs.readFileSync(packageLockJsonPath));
}

/**
 * Get the dependency map () for a given root package path
 * @param   {String} rootPath The path to the root package
 * @returns {Object}          The dependency map
 */
function getDependencyMap(rootPath) {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
  const lockfile = parseLockfile(rootPath)

  const lockfileVersion = lockfile.lockfileVersion;
  let dependencyMap = {};
  switch (lockfileVersion) {
    case 1:
      dependencyMap = dependencyMapFromLockfileVersion1(lockfile, packageJson, rootPath);
      break;
    case 2:
    case 3:
      dependencyMap = dependencyMapFromLockfileVersion2or3(lockfile, rootPath);
      break;
  }
  return dependencyMap;
}

/**
 * Add all dependencies in the node_modules directory to the nodeMap and dependencyMap
 * @param {String} modulesPath     Path to the directory containing the dependencies
 * @param {String} nodeModulesPath Path to the root packages' node_modules directory
 * @param {Object} nodeMap         The node map
 * @param {Object} depMap          The dependency map
 */
function addDependencies(modulesPath, nodeModulesPath, nodeMap, depMap) {
  for (const dir of fs.readdirSync(modulesPath)) {
    if (dir.startsWith('.')) {
      continue;
    }
    if (dir.startsWith('@')) {
      addDependencies(path.join(modulesPath, dir), nodeModulesPath, nodeMap, depMap);
      continue;
    }
    const modulePath = path.join(modulesPath, dir);
    const modulePackageJson = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json')));
    const moduleDependencies = Object.keys(modulePackageJson.dependencies || {});
    nodeMap[modulePath] = new Node(modulePath);
    depMap[modulePath] = moduleDependencies.map((dep) => path.join(nodeModulesPath, dep));
  }
}

/**
 * Get the dependency graph (i.e. a mapping that maps packagePaths to a Graph of Nodes, representing
 * dependency relationships)
 * @param   {String} rootPath Path to the root package
 * @returns {Object}          The resulting dependency graph
 */
function getDependencyGraph(rootPath) {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
  const rootDependencies = Object.keys(packageJson.dependencies || {});
  const nodeModulesPath = path.join(rootPath, 'node_modules');

  // {packagePath: Node}
  const nodeMap = {};
  nodeMap[rootPath] = new Node(rootPath);
  // {packagePath: Array[dependencyPath]}
  const depMap = {};
  depMap[rootPath] = rootDependencies.map((dep) => path.join(nodeModulesPath, dep));

  addDependencies(nodeModulesPath, nodeModulesPath, nodeMap, depMap);

  for (const packagePath of Object.keys(depMap)) {
    const dependencies = depMap[packagePath];
    for (const dependencyPath of dependencies) {
      nodeMap[packagePath].addDependency(nodeMap[dependencyPath]);
    }
  }

  return nodeMap[rootPath];
}

module.exports = {
  getDependencyGraph: getDependencyGraph,
  getDependencyMap: getDependencyMap
}
