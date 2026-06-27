/* electron-builder afterSign hook — notarizes the .app with Apple, the way Granola does it.
   It only runs when Apple credentials are present in the environment, so a plain
   `npm run dist` with no creds still produces today's (ad-hoc) build without erroring.

   To produce a signed + notarized build (after enrolling in the Apple Developer Program):
     export APPLE_ID="you@icloud.com"
     export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → App-Specific Passwords
     export APPLE_TEAM_ID="XXXXXXXXXX"                          # your Developer Team ID
     export CSC_LINK="/absolute/path/DeveloperIDApplication.p12" # exported Developer ID Application cert
     export CSC_KEY_PASSWORD="the-p12-password"
     npm run dist
*/
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log("[notarize] Apple credentials not set — skipping notarization (build stays ad-hoc).");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`[notarize] Submitting ${appPath} to Apple notary service…`);

  await notarize({
    tool: "notarytool",
    appBundleId: "com.versify.app",
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log("[notarize] Done — Apple has notarized Versify.");
};
