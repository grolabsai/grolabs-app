import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  { ignores: ["docs/**"] },
  ...nextConfig,
];

export default eslintConfig;
