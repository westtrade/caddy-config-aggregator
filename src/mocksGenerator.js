const merge = require("lodash.merge");
const dayjs = require("dayjs");

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

module.exports = {
	makeWebsiteDeploy,
	makeNewRelease,
	makeReleaseName,
};
