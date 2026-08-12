// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Plain-JS build scripts run under Node; typescript-eslint already disables
    // no-undef for .ts files, so only these need the globals declared.
    files: ["**/*.mjs", "**/*.cjs", "**/scripts/**/*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    // Rules of Hooks matter most in the React SDK and the demo's components.
    files: ["packages/react/**/*.{ts,tsx}", "examples/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
