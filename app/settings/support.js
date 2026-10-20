import { t as tr } from "../i18n.js";
import { icon } from "../icons.js";
export const SUPPORT_ADDRESS = "0x6bf40ccb46abbc6485778f98c305ba4570854409";
// Ethereum plus widely used EVM rollups; each link opens this same public address.
const networks = [
  ["Ethereum", "https://etherscan.io"],
  ["Base", "https://basescan.org"],
  ["Arbitrum One", "https://arbiscan.io"],
  ["OP Mainnet", "https://optimistic.etherscan.io"],
];
export function renderSupport() {
  return `<div class="support-card"><p>${tr("支持 Glassmark 的持续开发")}</p><div class="support-address"><code id="support-address">${SUPPORT_ADDRESS}</code><button type="button" id="support-copy-address" class="secondary">${icon("copy")}${tr("复制地址")}</button></div><div class="support-networks">${networks.map(([name, url]) => `<a href="${url}/address/${SUPPORT_ADDRESS}" target="_blank" rel="noopener noreferrer">${name}</a>`).join("")}</div><p class="support-network-note">${tr("以上网络共用此 EVM 地址，请在钱包中选择对应网络。")}</p></div>`;
}
