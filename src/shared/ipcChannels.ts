// Single source of truth for IPC channel names — imported by main and preload only.
// Renderer never invokes these strings directly; it only calls window.ponyabc.* methods.
export const IPC = {
  registrationOpen: 'ponyabc:registration:open',
  privacyPolicyOpen: 'ponyabc:registration:privacyOpen',
  supportEmailOpen: 'ponyabc:support:emailOpen',

  penRootScan: 'ponyabc:penRoot:scan',
  penRootChooseCandidate: 'ponyabc:penRoot:chooseCandidate',
  penRootSelect: 'ponyabc:penRoot:select',
  penRootVolumesChanged: 'ponyabc:penRoot:volumes-changed',
  recordingsList: 'ponyabc:recordings:list',

  computerFolderSelect: 'ponyabc:computerFolder:select',
  computerFolderRestore: 'ponyabc:computerFolder:restore',
  computerFolderList: 'ponyabc:computerFolder:list',

  copyToComputer: 'ponyabc:transfer:toComputer',

  transferToPenPlan: 'ponyabc:transfer:toPen:plan',
  transferToPenExecute: 'ponyabc:transfer:toPen:execute',

  replaceStickerPlan: 'ponyabc:transfer:replaceSticker:plan',
  replaceStickerExecute: 'ponyabc:transfer:replaceSticker:execute',

  transferProgress: 'ponyabc:transfer:progress',

  audioPreviewRead: 'ponyabc:audio:read',

  bookList: 'ponyabc:book:list',
  bookCatalogRefresh: 'ponyabc:book:catalog:refresh',
  bookAdd: 'ponyabc:book:add',
  bookUpdate: 'ponyabc:book:update',
  bookReinstall: 'ponyabc:book:reinstall',
  bookRemove: 'ponyabc:book:remove',
  bookBackups: 'ponyabc:book:backups',
  bookRestore: 'ponyabc:book:restore',
  bookDownloadCancel: 'ponyabc:book:downloadCancel',
  bookDownloadProgress: 'ponyabc:book:downloadProgress',
  bookDownloadBatch: 'ponyabc:book:downloadBatch',
  bookDownloadBatchCancel: 'ponyabc:book:downloadBatchCancel',
  bookDownloadBatchSummary: 'ponyabc:book:downloadBatchSummary',
  bookVerifyContent: 'ponyabc:book:verifyContent',
  bookVerifyCancel: 'ponyabc:book:verifyCancel',
  bookVerifyProgress: 'ponyabc:book:verifyProgress',
  bookVerifyUpdate: 'ponyabc:book:verifyUpdate',

  diagnosticsSummary: 'ponyabc:diagnostics:summary',
  diagnosticsExport: 'ponyabc:diagnostics:export',

  firmwareSelectPackage: 'ponyabc:firmware:selectPackage',
  firmwareStart: 'ponyabc:firmware:start',
  firmwareProgress: 'ponyabc:firmware:progress',
  firmwareOutcome: 'ponyabc:firmware:outcome',
  firmwareAcknowledgeOutcome: 'ponyabc:firmware:acknowledgeOutcome',
  firmwareIsInProgress: 'ponyabc:firmware:isInProgress',
  firmwareRecoveryStatus: 'ponyabc:firmware:recoveryStatus',
  firmwareRecoveryRecheck: 'ponyabc:firmware:recoveryRecheck',

  settingsGet: 'ponyabc:settings:get',
  settingsSet: 'ponyabc:settings:set',

  appInfoGet: 'ponyabc:app:info',
  appCheckForUpdates: 'ponyabc:app:checkForUpdates',
  appOpenLatestReleasePage: 'ponyabc:app:openLatestReleasePage',
} as const;
