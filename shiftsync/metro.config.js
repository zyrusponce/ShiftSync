// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// The API in server/ has its own dependencies and secrets handling; keep it
// (and its node_modules) out of the mobile bundle and the file watcher.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const serverDir = path
  .resolve(__dirname, "server")
  .split(/[\\/]/)
  .map(escape)
  .join("[\\\\/]");
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${serverDir}[\\\\/].*$`),
];
module.exports = config;
