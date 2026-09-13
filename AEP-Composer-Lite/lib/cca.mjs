#!/usr/bin/env node
/**
 * Composer Lite CCA bridge - delegates to cca/ component.
 */

export {
  getCcaPublicState,
  runCcaChat,
  extractGraphSuggestion,
} from "../../AEP-CCA-Central-Setup-Agent/lib/chat.mjs";