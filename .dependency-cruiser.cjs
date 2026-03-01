/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
      comment: "Circular dependencies make code harder to reason about.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "info",
      comment: "Orphaned modules are potential dead code.",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "(^|/)(vitest|jest)\\.config\\."] },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment: "Importing deprecated Node.js core modules.",
      from: {},
      to: { dependencyTypes: ["core"], path: "^(punycode|domain|freelist|sys|constants)$" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
    },
  },
};
