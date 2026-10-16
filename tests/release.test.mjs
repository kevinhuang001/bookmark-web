import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

test("release publishes installable assets and removes old JSON reports with matching checksum entries", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  const script = workflow
    .split("          script: |\n")[1]
    .split("\n")
    .map((line) => line.slice(12))
    .join("\n");
  const root = await mkdtemp(path.join(os.tmpdir(), "glassmark-release-"));
  const previous = process.cwd();
  const names = [
    "Glassmark.dmg",
    "Glassmark.exe",
    "Glassmark.msi",
    "Glassmark.deb",
    "Glassmark.rpm",
    "glassmark.pkg.tar.zst",
    "Glassmark.AppImage",
    "glassmark-chromium.zip",
    "glassmark-firefox.zip",
  ];
  const assets = new Map([
    [
      1,
      [
        { id: 11, name: "e2e-report.json" },
        {
          id: 12,
          name: "SHA256SUMS.txt",
          browser_download_url: "https://example.test/checksums",
        },
        { id: 13, name: "Glassmark.deb" },
      ],
    ],
    [2, []],
  ]);
  let nextId = 20,
    published = false;
  const uploads = [];
  const repos = {
    getReleaseByTag: async () => {
      throw Object.assign(new Error("missing"), { status: 404 });
    },
    createRelease: async () => ({
      data: { id: 2, html_url: "https://example.test/release" },
    }),
    listReleaseAssets: async ({ release_id }) => ({
      data: assets.get(release_id),
    }),
    listReleases: async () => ({
      data: [
        { id: 1, draft: false },
        { id: 2, draft: true },
      ],
    }),
    deleteReleaseAsset: async ({ asset_id }) => {
      for (const [id, list] of assets)
        assets.set(
          id,
          list.filter((a) => a.id !== asset_id),
        );
    },
    uploadReleaseAsset: async ({ release_id, name, data }) => {
      assets.get(release_id).push({ id: nextId++, name });
      uploads.push({ release_id, name, data });
    },
    updateRelease: async ({ draft }) => {
      assert.equal(
        assets.get(1).some((a) => a.name.endsWith(".json")),
        false,
      );
      published = !draft;
    },
  };
  const github = {
    rest: { repos },
    paginate: async (fn, args) => (await fn(args)).data,
  };
  try {
    await mkdir(path.join(root, "release-input"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.7.0" }),
    );
    for (const name of names)
      await writeFile(path.join(root, "release-input", name), "installer");
    for (const name of ["e2e", "extension", "firefox"])
      await writeFile(
        path.join(root, "release-input", name + "-report.json"),
        JSON.stringify({ backend: "native-rust" }),
      );
    process.chdir(root);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    await new AsyncFunction(
      "require",
      "github",
      "context",
      "core",
      "fetch",
      script,
    )(
      createRequire(import.meta.url),
      github,
      {
        repo: { owner: "test", repo: "glassmark" },
        payload: {
          workflow_run: {
            head_sha: "verified",
            html_url: "https://example.test/ci",
          },
        },
      },
      { notice() {} },
      async () => ({
        ok: true,
        text: async () => "abc  Glassmark.deb\ndef  e2e-report.json\n",
      }),
    );
    assert.equal(published, true);
    assert.equal(
      uploads.some((a) => a.name.endsWith(".json")),
      false,
    );
    assert.deepEqual(
      assets
        .get(2)
        .map((a) => a.name)
        .sort(),
      [...names, "SHA256SUMS.txt"].sort(),
    );
    assert.equal(
      uploads.find((a) => a.release_id === 1).data.toString(),
      "abc  Glassmark.deb\n",
    );
    assert.equal(
      assets.get(1).some((a) => a.name === "Glassmark.deb"),
      true,
    );
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
