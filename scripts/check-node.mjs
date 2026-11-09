const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`需要 Node.js 22.5 或更高版本才能使用内置 node:sqlite。当前是 ${process.versions.node}`);
  process.exit(1);
}
