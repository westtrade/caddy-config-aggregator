const path = require("node:path");
const dayjs = require("dayjs");
const fs = require("node:fs/promises");
const { default: rimraf } = require("rimraf");
const { inspect } = require("node:util");
const merge = require("lodash.merge");
const { configWatcher, callbackExecutor } = require("../src/configWatcher");

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

const SETTINGS_STARTS_REGEXP = /^#/;

const getEntryInfo = (pathInfo) => {
	const result = Object.entries(pathInfo).reduce(
		(result, [key, value]) => {
			if (key.startsWith("#")) {
				const settingsKey = key.replace(SETTINGS_STARTS_REGEXP, "");
				result.settings[settingsKey] = value;
			} else {
				result.entries[key] = value;
			}
			return result;
		},
		{
			settings: {},
			entries: {},
		}
	);

	result.settings.type = result.settings.type ?? "directory";

	return result;
};

const treeToFlatFSStructureReducer = (
	{ rootPath, flatFsStructure: prevFsStructure = [] },
	[localPath, combinedContent]
) => {
	const { settings, entries } = getEntryInfo(combinedContent);

	const fullPath = path.resolve(rootPath, localPath);

	let nestedFlatFsStructure = {};
	if (settings.type === "directory") {
		nestedFlatFsStructure = Object.entries({
			...entries,
		}).reduce(treeToFlatFSStructureReducer, {
			rootPath: fullPath,
			flatFsStructure: {},
		}).flatFsStructure;
	}

	const flatFsStructure = {
		...prevFsStructure,
		[fullPath]: { ...settings },
		...nestedFlatFsStructure,
	};

	return {
		rootPath,
		flatFsStructure,
	};
};

const applySettingsToPath = async (targetPath, settings = {}) => {
	let pathInfo = null;
	try {
		pathInfo = await fs.lstat(targetPath);
	} catch (error) {}

	switch (settings.type) {
		case "absent":
			await rimraf(targetPath);
			break;

		case "directory":
			if (settings.clear) {
				await rimraf(targetPath);
			}

			await fs.mkdir(targetPath, { recursive: true });
			break;

		case "file":
			if (pathInfo !== null) {
				await fs.unlink(targetPath);
			}
			await fs.writeFile(targetPath, settings.content);
			break;

		case "link":
			if (pathInfo !== null) {
				await fs.unlink(targetPath);
			}

			await fs.symlink(settings.to, targetPath);
			break;
	}
};

const makeFsStructure = async (rootPath, fsStructure) => {
	const { settings, entries } = getEntryInfo(fsStructure);

	const pathMap = {
		[rootPath]: { ...settings },
		...(await Object.entries(entries).reduce(treeToFlatFSStructureReducer, {
			rootPath,
			flatFsStructure: {},
		}).flatFsStructure),
	};

	const pathList = [];

	for (const [localPath, config] of Object.entries(pathMap)) {
		await applySettingsToPath(localPath, config);
		pathList.push(localPath);
	}

	return pathList;
};

const makeReleaseInfoFiles = (releaseName, caddy, env) => {
	return {
		".env": {
			"#type": "file",
			"#content": env,
		},
		docker: {
			caddy: {
				Caddyfile: {
					"#type": "file",
					"#content": caddy,
				},
			},
		},
		release: {
			"#type": "file",
			"#content": releaseName,
		},
	};
};

const makeReleaseName = (releaseShift = 0) =>
	dayjs(Date.now() + releaseShift).format("YYYYMMDDHHmmssSSS");

const makeNewRelease = (siteName, releaseShift = 0, caddy, env) => {
	const currentRelease = makeReleaseName(releaseShift);

	return {
		[siteName]: {
			releases: {
				[currentRelease]: makeReleaseInfoFiles(currentRelease, caddy, env),
			},
		},
	};
};

const makeWebsiteDeploy = (websiteName, releases = [], clear = false) => {
	const fullReleases = [];
	for (const realseArgs of releases) {
		fullReleases.push(makeNewRelease(websiteName, ...realseArgs));
	}

	const websiteFSStruture = {
		[websiteName]: {
			"#clear": clear,
			current: {
				"#type": "link",
				"#to": `releases/${
					Object.entries(fullReleases[0][websiteName].releases)[0][0]
				}`,
			},
		},
	};

	return merge(websiteFSStruture, ...fullReleases);
};

async function initializeDefaultFileStructure() {
	const websiteProdInitialDeploy = makeWebsiteDeploy(
		"website-production",
		[
			[0, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[5436, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
			[12345, DEFAULT_CADDY_CONFIG_CONTENT, DEFAULT_ENV_FILE_CONTENT_1],
		],
		true
	);

	await makeFsStructure(ROOT_CONFIG_OUT_PATH, {
		"#clear": true,
	});

	return await makeFsStructure(
		ROOT_LOCAL_CONFIGS_PATH,
		websiteProdInitialDeploy
	);
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
		watcher = configWatcher(
			ROOT_LOCAL_CONFIGS_PATH,
			ROOT_CONFIG_OUT_PATH,
			callbackExecutor("docker ps")
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
		// await clearTestDataStructure();
	});
});
