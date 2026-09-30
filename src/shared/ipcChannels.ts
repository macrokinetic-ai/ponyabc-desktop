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

  // Recordings v2 — snapshot backups, restore, per-side delete, sticker reassign, labels.
  recordingBackupCreate: 'ponyabc:recordingBackup:create',
  recordingBackupList: 'ponyabc:recordingBackup:list',
  recordingBackupContents: 'ponyabc:recordingBackup:contents',
  recordingRestorePlan: 'ponyabc:recordingBackup:restore:plan',
  recordingRestoreExecute: 'ponyabc:recordingBackup:restore:execute',
  recordingDeleteFromPen: 'ponyabc:recordingBackup:deletePen',
  recordingDeleteFromBackup: 'ponyabc:recordingBackup:deleteBackup',
  recordingReassign: 'ponyabc:recordingBackup:reassign',
  recordingLabelsGet: 'ponyabc:recordingBackup:labels:get',
  recordingLabelSet: 'ponyabc:recordingBackup:labels:set',
  recordingLegacyScan: 'ponyabc:recordingBackup:legacy:scan',
  recordingLegacyMigrate: 'ponyabc:recordingBackup:legacy:migrate',
  recordingBackupProgress: 'ponyabc:recordingBackup:progress',

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

  // The pen's book index — reset after adds/removes, and the self-heal check.
  bookWriteProgress: 'ponyabc:book:writeProgress',
  bookIndexStatus: 'ponyabc:book:index:status',

  // Testing mode — the Internal build only. Both builds register these handlers; in the Store
  // build they are wired to the stubs in src/main/internal/stub.ts, which report testing mode
  // off, ignore any attempt to switch it on, and hand back no tester key and no folder. The
  // Store renderer has nothing that invokes them: the screen is not hidden, it is not built.
  testingModeGet: 'ponyabc:testing:get',
  testingModeSet: 'ponyabc:testing:set',
  testingModeChooseFolder: 'ponyabc:testing:chooseFolder',
  bookIndexCommit: 'ponyabc:book:index:commit',
  // A sync opens a batch so the many writes inside it cost the pen one index reset, not one per
  // book. Every write outside a batch settles itself in the main process — see
  // finishPenBookMutation in main/ipc/bookIndex.ts.
  bookBatchBegin: 'ponyabc:book:batch:begin',
  bookBatchEnd: 'ponyabc:book:batch:end',
  bookIndexFix: 'ponyabc:book:index:fix',
  bookDownloadBatchCancel: 'ponyabc:book:downloadBatchCancel',
  bookDownloadBatchSummary: 'ponyabc:book:downloadBatchSummary',
  bookVerifyContent: 'ponyabc:book:verifyContent',
  bookVerifyCancel: 'ponyabc:book:verifyCancel',
  bookVerifyProgress: 'ponyabc:book:verifyProgress',
  bookVerifyUpdate: 'ponyabc:book:verifyUpdate',

  diagnosticsSummary: 'ponyabc:diagnostics:summary',
  diagnosticsExport: 'ponyabc:diagnostics:export',
  firmwareDiagnosticsExport: 'ponyabc:firmware:diagnosticsExport',

  firmwareSelectPackage: 'ponyabc:firmware:selectPackage',
  firmwareStart: 'ponyabc:firmware:start',
  firmwareProgress: 'ponyabc:firmware:progress',
  firmwareOutcome: 'ponyabc:firmware:outcome',
  firmwareAcknowledgeOutcome: 'ponyabc:firmware:acknowledgeOutcome',
  firmwareIsInProgress: 'ponyabc:firmware:isInProgress',
  firmwareRecoveryStatus: 'ponyabc:firmware:recoveryStatus',
  firmwareRecoveryRecheck: 'ponyabc:firmware:recoveryRecheck',

  firmwareGetOfficialRelease: 'ponyabc:firmware:getOfficialRelease',
  firmwarePrepareOfficialPackage: 'ponyabc:firmware:prepareOfficialPackage',
  firmwareDownloadProgress: 'ponyabc:firmware:downloadProgress',
  firmwareCancelDownload: 'ponyabc:firmware:cancelDownload',

  settingsGet: 'ponyabc:settings:get',
  settingsSet: 'ponyabc:settings:set',

  appInfoGet: 'ponyabc:app:info',
  appCheckForUpdates: 'ponyabc:app:checkForUpdates',
  appOpenLatestReleasePage: 'ponyabc:app:openLatestReleasePage',
} as const;
