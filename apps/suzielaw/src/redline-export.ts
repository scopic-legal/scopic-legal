// Thin wrapper that keeps suzielaw's existing import paths
// (`./redline-export.js`) and the historical `composeRedlineDocx` name
// while sourcing the implementation from `@teamsuzie/docx`. Drop this
// file once every call site has been migrated to import `composeRedline`
// directly from `@teamsuzie/docx`.
export {
  composeRedline as composeRedlineDocx,
  redlineDownloadFilename,
} from '@teamsuzie/docx';
export type { ComposeRedlineOptions } from '@teamsuzie/docx';
