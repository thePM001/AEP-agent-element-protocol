#!/usr/bin/env node
/**
 * Composer Lite CCA bridge - delegates to cca/ component.
 */

export {
  getCcaPublicState,
  runCcaChat,
  extractGraphSuggestion,
} from "../../AEP-Components/cca/lib/chat.mjs";