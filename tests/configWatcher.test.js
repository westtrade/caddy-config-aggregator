const path = require("node:path");
const { makeFsStructure } = require("../src/blueprintFS");

const { configWatcher, callbackExecutor } = require("../src/configWatcher");
const { makeWebsiteDeploy, makeNewRelease } = require("../src/mocksGenerator");

const ROOT_PATH = path.resolve(__dirname, "../test-data");
const ROOT_CONFIG_OUT_PATH = path.resolve(ROOT_PATH, "out");
const ROOT_LOCAL_CONFIGS_PATH = path.resolve(ROOT_PATH, "data");

const DEFAULT_ENV_FILE_CONTENT_1 = `
APP_HOST=acme.nope
APP_TLS_EMAIL=support@acme.nope
APP_BRANCH=production
`;

const DEFAULT_ENV_FILE_CONTENT_2 = `
APP_HOST=acme-2.nope
APP_TLS_EMAIL=support@acme-2.nope
APP_BRANCH=development
`;

const DEFAULT_ENV_FILE_CONTENT_3 = `
APP_HOST=acme-2.nope
APP_TLS_EMAIL=support@acme-2.nope
APP_BRANCH=development
`;

const DEFAULT_CADDY_CONFIG_CONTENT = `
{$APP_HOST:acme.net}.localhost, {$APP_HOST:acme.net} {
    root * /var/www/website-{$APP_BRANCH:production}/current/public
    tls {$APP_TLS_EMAIL:internal}
}
`;

async function initializeDefaultFileStructure() {
	await makeFsStructure(ROOT_CONFIG_OUT_PATH, {
		"#clear": true,
	});

	await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, {
		"#clear": true,
	});

	const websiteProdInitialDeploy = makeWebsiteDeploy(
		"website-production",
		[
			[0, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[5436, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[12345, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
		],
		true
	);

	await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, websiteProdInitialDeploy);
}

async function clearTestDataStructure() {
	await makeFsStructure(ROOT_PATH, {
		"#clear": true,
	});
}

describe("Config watcher", () => {
	let watcher = null;
	beforeAll(async () => {
		await initializeDefaultFileStructure();
		const command = `
			caddy_container_id=$(docker ps | grep caddy_web | awk '{print $1;}')
			docker exec $caddy_container_id reload --config /etc/caddy/Caddyfile --adapter caddyfile
		`;
		watcher = await configWatcher(
			ROOT_LOCAL_CONFIGS_PATH,
			ROOT_CONFIG_OUT_PATH
			// callbackExecutor(command)
		);
	});

	it("should global settings settings by local at startup", async () => {
		await new Promise((r) => setTimeout(r, 2000));
	});

	it("should regenerate configurations after added new website", async () => {
		const websiteNewDeploy = makeWebsiteDeploy("website-stage", [
			[0, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[5436, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[12345, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
		]);

		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, websiteNewDeploy);

		await new Promise((r) => setTimeout(r, 2000));
	});

	it("should regenerate configurations after website removed", async () => {
		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, {
			"website-production": {
				"#type": "absent",
			},
		});

		await new Promise((r) => setTimeout(r, 1000));
	});

	it("should regenerate configurations after website removed", async () => {
		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, {
			"website-stage": {
				current: {
					"#type": "absent",
				},
			},
		});

		await new Promise((r) => setTimeout(r, 1000));
	});

	it("should regenerate configurations after local website settings changed", () => {});

	it("should regenerate configurations after link to release changed", async () => {
		const websiteName = "website-test";

		const websiteProdInitialDeploy = makeWebsiteDeploy(websiteName, [
			[0, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[5436, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_2],
		]);

		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, websiteProdInitialDeploy);
		await new Promise((r) => setTimeout(r, 1000));

		console.log(
			"objec---------------------------------------------------------------t"
		);

		const newRelease = makeNewRelease(
			websiteName,
			0,
			DEFAULT_CADDY_CONFIG_CONTENT,
			DEFAULT_ENV_FILE_CONTENT_3
		);

		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, newRelease);

		await new Promise((r) => setTimeout(r, 1000));
		console.log(
			"---------------------------------------------------------------------"
		);

		await makeFsStructure(ROOT_LOCAL_CONFIGS_PATH, {
			[websiteName]: {
				current: {
					"#type": "link",
					"#to": `releases/${Object.entries(newRelease[websiteName].releases)
						.at(0)
						.at(0)}`,
				},
			},
		});

		await new Promise((r) => setTimeout(r, 1000));
	});

	afterAll(async () => {
		if (watcher) {
			watcher.close();
		}
		await clearTestDataStructure();
	});
});
