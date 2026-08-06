// TS7 (tsgo, typecheck:fast) exige declaración para imports side-effect de CSS;
// tsc 5.x los ignora. Sin esto, `import "./globals.css"` da TS2882 solo en tsgo.
declare module "*.css";
