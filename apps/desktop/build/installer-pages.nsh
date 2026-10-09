; Loaded when customWelcomePage expands, after electron-builder's common.nsh.
; NSIS does not allow a macro definition nested directly inside another macro.
!macro skipPageIfUpdated
  !define MUI_PAGE_CUSTOMFUNCTION_PRE GitNestSkipExistingPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW GitNestDirectoryShow
!macroend
