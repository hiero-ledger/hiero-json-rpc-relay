const replace = require("replace");
const { execSync } = require("child_process");

const versionRegex = /\d+\.\d+\.\d+(-\w+)?/i;
const newVersion = process.env.SEM_VER;
const isSnapshot = process.env.SNAPSHOT ? process.env.SNAPSHOT == "true" : false;

function checkVersion(semver) {
  if (semver == undefined || semver == "") {
    console.log("semver cannot be blank");
    process.exit(1);
  }

  if (semver.match(versionRegex) == undefined) {
    console.log(
      `semver: ${semver} must be Semantic Version <Major>.<Minnor>.<Patch>[-<type>], examples: '0.20.0', '0.20.0-rc1'`,
    );
    process.exit(1);
  }

  return semver;
}

// check is a valid version
checkVersion(newVersion);

console.log(`Bumping version to: ${newVersion}`);
console.log(`is Snapshot: ${isSnapshot}`);

// bumping version using replace for 'packages/config-service/package.json', 'packages/relay/package.json', 'packages/server/package.json', 'docs/openrpc.json', 'packages/ws-server/package.json'
// looking for: "version": "0.20.0-SNAPSHOT", "version": "0.20.0-rc1", "version": "0.20.0"
const packageRegex = '"version": "\\d+\\.\\d+\\.\\d+(-\\w+)?"';
replace({
  regex: packageRegex,
  replacement: `"version": "${newVersion}"`,
  paths: [
    "package.json",
    "packages/config-service/package.json",
    "packages/relay/package.json",
    "packages/server/package.json",
    "docs/openrpc.json",
    "packages/ws-server/package.json",
  ],
  recursive: false,
  silent: false,
});

// bump only when is not snapshot
if (!isSnapshot) {
  // bump docker-compose.yml version
  // looking for: image: "ghcr.io/hiero-ledger/hiero-json-rpc-relay:0.20.0-SNAPSHOT", image: "ghcr.io/hiero-ledger/hiero-json-rpc-relay:0.20.0-rc1", image: "ghcr.io/hiero-ledger/hiero-json-rpc-relay:0.20.0", image: "ghcr.io/hiero-ledger/hiero-json-rpc-relay:main"
  const dockerComposeRegex = 'image: "ghcr.io\\/hiero-ledger\\/hiero-json-rpc-relay:(main|\\d+\\.\\d+\\.\\d+(-\\w+)?)"';
  replace({
    regex: dockerComposeRegex,
    replacement: `image: "ghcr.io/hiero-ledger/hiero-json-rpc-relay:${newVersion}"`,
    paths: ["docker-compose.yml"],
    recursive: false,
    silent: false,
  });

  const majorMinorVersion = `${newVersion.split(".")[0]}.${newVersion.split(".")[1]}`;

  // also update README.md using replace
  //looking for: "/hiero-ledger/hiero-json-rpc-relay/main/docs/openrpc.json", "/hiero-ledger/hiero-json-rpc-relay/release/0.20/docs/openrpc.json"
  const readmeRegex =
    "(\\/hiero-ledger\\/hiero-json-rpc-relay\\/){1}(main|(release\\/\\d+.\\d+)){1}(\\/docs\\/openrpc.json){1}";
  replace({
    regex: readmeRegex,
    replacement: `/hiero-ledger/hiero-json-rpc-relay/release/${majorMinorVersion}/docs/openrpc.json`,
    paths: ["README.md"],
    recursive: false,
    silent: false,
  });
}

// bump helm chart versions
// looking for: "version: 0.20.0-SNAPSHOT", "version: 0.20.0-rc1", "version: 0.20.0"
const helmChartRegex = "version: \\d+\\.\\d+\\.\\d+(-\\w+)?";
replace({
  regex: helmChartRegex,
  replacement: `version: ${newVersion}`,
  paths: ["charts/hedera-json-rpc-relay/Chart.yaml", "charts/hedera-json-rpc-relay-websocket/Chart.yaml","charts/hedera-json-rpc/Chart.yaml"],
  recursive: false,
  silent: false,
});
// looking for: appVersion: "0.20.0-SNAPSHOT", appVersion: "0.20.0-rc1", appVersion: "0.20.0"
const helmChartAppVersionRegex = 'appVersion: "\\d+\\.\\d+\\.\\d+(-\\w+)?"';
replace({
  regex: helmChartAppVersionRegex,
  replacement: `appVersion: "${newVersion}"`,
  paths: ["charts/hedera-json-rpc-relay/Chart.yaml", "charts/hedera-json-rpc-relay-websocket/Chart.yaml","charts/hedera-json-rpc/Chart.yaml"],
  recursive: false,
  silent: false,
});

// bump package-lock.json using npm itself, by running install it will update packages versions based on previous files
execSync("npm install");
console.log("package-lock.json");
console.log("All files were bumped successfully!");
