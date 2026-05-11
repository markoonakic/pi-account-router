import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installAccountRouter } from "./install.js";

export default function install(pi: ExtensionAPI): void {
  installAccountRouter(pi);
}
