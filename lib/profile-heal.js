/**
 * 用户层 profile 自愈（本分支合成版）
 *
 * 上游 1.1.83 的 `profile-insert.js` 把「本体 insert 写用户层 profile」当成首选落地方式，
 * 因此 `ensureAllProfileInstall()` = bundles + **body insert** + pnpm allowBuilds。
 *
 * 本分支（1.4.x 线）的 `cordis.patch.yml` 里已经**内联**了 `- insert: [dsh-purge …]`，
 * 再往 `profiles/<name>/cordis.patch.yml` 写一遍 insert 会让同一个 id 入队两次
 *（上游 #152 / #154 / #159 就是这条路径上的坑）。所以这里只取上游真正能补洞的两段：
 *
 *   · `ensureProfileBundles`  —— `package.json` 的 `dsh.profile.bundles` 缺 `dsh-purge` 时补上；
 *   · `ensurePnpmAllowBuild`   —— #185：`pnpm-workspace.yaml` 的 `allowBuilds` 只写裸包名。
 *                                 pnpm 11 把 `dsh-purge@https://…` 当版本联合解析会直接崩 install。
 *
 * body insert 仍然可从 `profile-insert.js` 直接调用，只是不在这里自动执行 ——
 * 将来若把 insert 从 bundle patch 挪回用户层，把 `includeBodyInsert` 打开即可。
 */
import fs from "node:fs";
import path from "node:path";
import { ensurePnpmAllowBuild, ensureProfileBodyInsert, ensureProfileBundles, listProfileDirs } from "./profile-insert.js";

/* 与上游一致：只处理真正依赖 dsh-purge 的 profile，别去碰别人的 profile。 */
function profileOwnsPurge(profileDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
    const deps = pkg && pkg.dependencies ? pkg.dependencies : {};
    return Object.prototype.hasOwnProperty.call(deps, "dsh-purge");
  } catch {
    return false;
  }
}

/**
 * @param {string} dshHome
 * @param {{ includeBodyInsert?: boolean }} [opts]
 * @returns {Array<{dir: string, ok: boolean, bundles?: object, pnpm?: object, insert?: object, error?: string}>}
 */
export function healProfiles(dshHome, opts = {}) {
  const includeBodyInsert = opts.includeBodyInsert === true;
  const results = [];
  let dirs = [];
  try {
    dirs = listProfileDirs(dshHome);
  } catch {
    return results;
  }
  for (const dir of dirs) {
    if (!profileOwnsPurge(dir)) continue;
    try {
      const bundles = ensureProfileBundles(dir);
      const pnpm = ensurePnpmAllowBuild(dir);
      const item = { dir, ok: true, bundles, pnpm };
      if (includeBodyInsert) item.insert = ensureProfileBodyInsert(dir);
      results.push(item);
    } catch (error) {
      results.push({ dir, ok: false, error: error && error.message ? error.message : String(error) });
    }
  }
  return results;
}
