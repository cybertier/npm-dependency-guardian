const acorn_walk = require('acorn-walk');

// patch acorn-walk walkers to catch all identifiers

acorn_walk.base.ObjectPattern = function(node, st, c) {
  for (var i = 0, list = node.properties; i < list.length; i += 1) {
    var prop = list[i];

    c(prop, st, prop.type);
    // if (prop.type === "Property") {
    //   c(prop, st, "Property");
    //   // c(prop.key, st, "Expression");
    //   // c(prop.value, st, "Pattern");
    // } else if (prop.type === "RestElement") {
    //   c(prop.argument, st, "Pattern");
    // }
  }
};

acorn_walk.base.MemberExpression = function(node, st, c) {
  c(node.object, st, "Expression");
  c(node.property, st, "Expression");
};

acorn_walk.base.MethodDefinition = acorn_walk.base.PropertyDefinition = acorn_walk.base.Property = function(node, st, c) {
  c(node.key, st, "Expression");
  if (node.value) { c(node.value, st, "Expression"); }
};
