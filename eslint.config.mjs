import next from "eslint-config-next";

// Next 16 removed the `next lint` command; ESLint runs directly via this flat
// config. eslint-config-next 16 ships a native flat-config array (core-web-vitals
// + typescript), so we spread it directly — FlatCompat trips a circular-JSON bug.
const eslintConfig = [
  { ignores: ["tmp/**", ".next/**", "node_modules/**", "next-env.d.ts"] },
  ...next,
];

export default eslintConfig;
