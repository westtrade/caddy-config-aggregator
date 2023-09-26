const fs = require("node:fs/promises");
const {  rimraf } = require("rimraf");
const path = require("node:path");

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
				await rimraf(path.join(targetPath, "./*"), {
					preserveRoot: true,
				});
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

module.exports = {
	makeFsStructure,
	applySettingsToPath,
	treeToFlatFSStructureReducer,
	getEntryInfo,
	SETTINGS_STARTS_REGEXP,
};
