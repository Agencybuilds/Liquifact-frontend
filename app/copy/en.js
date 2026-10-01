/**
 * @typedef {Object} CopyDictionary
 * @property {Object} home - Home page copy
 * @property {string} home.heroTitle
 * @property {string} home.heroSub
 * @property {string} home.boxBusinessTitle
 * @property {string} home.boxBusinessSub
 * @property {string} home.boxBusinessAriaLabel
 * @property {string} home.boxInvestTitle
 * @property {string} home.boxInvestSub
 * @property {string} home.boxInvestAriaLabel
 * @property {string} home.apiStatus
 * @property {string} home.checkApiHealth
 * @property {string} home.checking
 * @property {{connected: string, degraded: string, unreachable: string, rawResponse: string}} home.healthStatus
 * @property {Object} invest - Invest page copy
 * @property {string} invest.title
 * @property {string} invest.subtext
 * @property {string} invest.emptyState
 * @property {string} invest.exampleHeading
 * @property {string} invest.exampleDisclaimer
 * @property {string} invest.errorTitle
 * @property {string} invest.errorDescription
 * @property {string} invest.errorStatus
 * @property {string} invest.searchPlaceholder
 * @property {string} invest.filterSoonLabel
 * @property {string} invest.filterLegend
 * @property {string} invest.retryAction
 * @property {string} invest.noMatchFilter
 * @property {string} invest.listAriaLabel
 * @property {string} invest.loadMore
 * @property {string} invest.loadMoreAriaLabel
 * @property {string} invest.yieldDisclaimer
 * @property {string} invest.labelYield
 * @property {string} invest.labelMaturity
 * @property {string} invest.announceNoInvoices
 * @property {string} invest.announceNoMatch
 * @property {string} invest.announceFilteredCount
 * @property {string} invest.announceInvoicesLoaded
 * @property {string} invest.announceShowing
 * @property {Object} invest.fundAmount - Partial funding input copy
 * @property {string} invest.fundAmount.label
 * @property {string} invest.fundAmount.placeholder
 * @property {string} invest.fundAmount.helper
 * @property {string} invest.fundAmount.expectedYieldLabel
 * @property {string} invest.fundAmount.errorRequired
 * @property {string} invest.fundAmount.errorPositive
 * @property {string} invest.fundAmount.errorExceedsBalance
 * @property {string} invest.fundAmount.errorPrecision
 * @property {string} invest.fundAmount.submitLabel
 * @property {string} invest.fundAmount.submittingLabel
 * @property {Object} invest.detail - Invoice detail page copy
 * @property {string} invest.detail.pageTitle
 * @property {string} invest.detail.pageSub
 * @property {string} invest.detail.backToMarketplace
 * @property {string} invest.detail.backToMarketplaceLabel
 * @property {string} invest.detail.backToHome
 * @property {string} invest.detail.summaryHeading
 * @property {string} invest.detail.labelIssuer
 * @property {string} invest.detail.labelAmount
 * @property {string} invest.detail.labelYield
 * @property {string} invest.detail.labelMaturity
 * @property {string} invest.detail.labelStatus
 * @property {string} invest.detail.fundButton
 * @property {string} invest.detail.fundButtonLabel
 * @property {string} invest.detail.copyLinkButton
 * @property {string} invest.detail.copyLinkButtonLabel
 * @property {string} invest.detail.printButton
 * @property {string} invest.detail.printButtonLabel
 * @property {string} invest.detail.disclaimerNote
 * @property {string} invest.detail.copySuccessMsg
 * @property {string} invest.detail.copySuccessTitle
 * @property {string} invest.detail.copyErrorMsg
 * @property {string} invest.detail.copyErrorTitle
 * @property {string} invest.detail.loadErrorMsg
 * @property {string} invest.detail.loadErrorTitle
 * @property {string} invest.detail.actionGroupLabel
 * @property {string} invest.detail.labelReference
 * @property {string} invest.detail.exportGroupLabel
 * @property {string} invest.detail.exportCSVButton
 * @property {string} invest.detail.exportCSVLabel
 * @property {string} invest.detail.exportJSONButton
 * @property {string} invest.detail.exportJSONLabel
 * @property {string} invest.detail.densityToggleLabel
 * @property {string} invest.detail.densityCompact
 * @property {string} invest.detail.densityComfortable
 * @property {string} invest.detail.densityCompactAriaLabel
 * @property {string} invest.detail.densityComfortableAriaLabel
 * @property {string} invest.detail.densityCurrentAriaLabel
 * @property {Object} invest.detail.networkMismatch - Network mismatch banner copy
 * @property {string} invest.detail.networkMismatch.bannerTitle
 * @property {string} invest.detail.networkMismatch.bannerBody
 * @property {string} invest.detail.networkMismatch.bannerBodyUnknown
 * @property {string} invest.detail.networkMismatch.bannerBodyDisconnected
 * @property {string} invest.detail.networkMismatch.alertLabel
 * @property {string} invest.detail.networkMismatch.announceMessage
 * @property {Object} invest.detail.inlineEdit - Inline edit mode copy for invoice-detail metadata rows
 * @property {string} invest.detail.inlineEdit.editButton
 * @property {string} invest.detail.inlineEdit.saveButton
 * @property {string} invest.detail.inlineEdit.cancelButton
 * @property {string} invest.detail.inlineEdit.errorRequired
 * @property {string} invest.detail.inlineEdit.announceSaved
 * @property {string} invest.detail.inlineEdit.announceCancelled
 * @property {Object} invest.detail.bulk - Bulk-select toolbar copy for invoice detail documents
 * @property {Object} invoices - Invoices page copy
 * @property {string} invoices.title
 * @property {string} invoices.subtext
 * @property {string} invoices.emptyState
 * @property {string} invoices.errorTitle
 * @property {string} invoices.errorDescription
 * @property {string} invoices.backToHome
 * @property {string} invoices.connectWallet
 * @property {string} invoices.editRowAction
 * @property {string} invoices.editRowAriaLabel
 * @property {string} invoices.saveEditAction
 * @property {string} invoices.saveEditAriaLabel
 * @property {string} invoices.cancelEditAction
 * @property {string} invoices.cancelEditAriaLabel
 * @property {string} invoices.issuerLabel
 * @property {string} invoices.amountLabel
 * @property {string} invoices.currencyLabel
 * @property {string} invoices.dueDateLabel
 * @property {string} invoices.yieldLabel
 * @property {string} invoices.errorIssuerRequired
 * @property {string} invoices.errorAmountRequired
 * @property {string} invoices.errorDueDateRequired
 * @property {string} invoices.errorCurrencyRequired
 * @property {string} invoices.announceEditStarted
 * @property {string} invoices.announceEditSuccess
 * @property {string} invoices.announceEditCancelled
 * @property {string} invoices.copyIdButton
 * @property {string} invoices.copyIdAriaLabel
 * @property {string} invoices.copyIdSuccessTitle
 * @property {string} invoices.copyIdSuccessMsg
 * @property {string} invoices.copyIdErrorTitle
 * @property {string} invoices.copyIdErrorMsg
 * @property {Object} layout - Layout copy
 * @property {string} layout.backToHome
 * @property {string} layout.connectWallet
 * @property {Object} footer - Footer copy
 * @property {string} footer.docs
 * @property {string} footer.docsUrl
 * @property {string} footer.status
 * @property {string} footer.statusUrl
 * @property {string} footer.contact
 * @property {string} footer.contactUrl
 * @property {string} footer.discord
 * @property {string} footer.discordUrl
 * @property {Object} uploadZone - Upload zone copy
 * @property {string} uploadZone.requirementsTitle
 * @property {string} uploadZone.badgePdfOnly
 * @property {string} uploadZone.badgeMaxSize
 * @property {string} uploadZone.badgeOneFile
 * @property {string} uploadZone.requirementsBody
 * @property {string} uploadZone.dropZoneLabel
 * @property {string} uploadZone.fileInputLabel
 * @property {string} uploadZone.dragDropPrompt
 * @property {string} uploadZone.browsePrompt
 * @property {string} uploadZone.changeFile
 * @property {string} uploadZone.submitIdle
 * @property {string} uploadZone.submitUploading
 * @property {string} uploadZone.submitTokenizing
 * @property {string} uploadZone.statusUploading
 * @property {string} uploadZone.statusTokenizing
 * @property {string} uploadZone.statusSuccess
 * @property {string} uploadZone.spinnerLabel
 * @property {string} uploadZone.errorNoFile
 * @property {string} uploadZone.errorInvalidType
 * @property {string} uploadZone.errorOversize
 * @property {string} uploadZone.errorEmpty
 * @property {string} uploadZone.errorInvalidPdf
 * @property {string} uploadZone.errorReadFailed
 * @property {string} uploadZone.errorUploadFailed
 * @property {string} uploadZone.errorUploadStatus
 * @property {string} uploadZone.resetAction
 * @property {string} uploadZone.resetAriaLabel
 * @property {Object} wallet - Wallet copy
 * @property {string} wallet.connectButton
 * @property {string} wallet.connectingButton
 * @property {string} wallet.disconnectButton
 * @property {string} wallet.retryButton
 * @property {string} wallet.switchNetworkButton
 * @property {string} wallet.installWalletButton
 * @property {string} wallet.copyAddressButton
 * @property {string} wallet.helperDisconnected
 * @property {string} wallet.helperConnecting
 * @property {string} wallet.helperConnected
 * @property {string} wallet.helperError
 * @property {string} wallet.helperWrongNetwork
 * @property {string} wallet.helperNoWallet
 * @property {string} wallet.installWalletUrl
 * @property {string} wallet.toastConnectedTitle
 * @property {string} wallet.toastConnectedMsg
 * @property {string} wallet.toastErrorTitle
 * @property {string} wallet.toastErrorMsg
 * @property {string} wallet.toastWrongNetworkTitle
 * @property {string} wallet.toastWrongNetworkMsg
 * @property {string} wallet.toastCopySuccessTitle
 * @property {string} wallet.toastCopySuccessMsg
 * @property {string} wallet.toastCopyErrorTitle
 * @property {string} wallet.toastCopyErrorMsg
 * @property {string} wallet.errorConnect
 * @property {string} wallet.errorWrongNetwork
 * @property {string} wallet.announceConnected
 * @property {string} wallet.announceDisconnected
 * @property {string} wallet.announceError
 * @property {string} wallet.announceWrongNetwork
 * @property {string} wallet.announceNoWallet
 * @property {string} wallet.errorTitle
 * @property {string} wallet.errorDescription
 * @property {string} wallet.errorActionLabel
 * @property {string} wallet.errorPreviewLabel
 * @property {Object} nav - Site navigation copy
 * @property {string} nav.errorTitle
 * @property {string} nav.errorDescription
 * @property {string} nav.errorActionLabel
 * @property {string} nav.announceNavigation - Template: "Navigated to {label}"
 * @property {Object} error - Error page copy
 * @property {string} error.title
 * @property {string} error.description
 * @property {string} error.actionLabel
 * @property {string} error.previewLabel
 * @property {Object} network - Network status copy
 * @property {string} network.offlineBanner
 * @property {string} network.reconnectedTitle
 * @property {string} network.reconnectedMsg
 * @property {Object} notFound - Not found page copy
 * @property {string} notFound.heading
 * @property {string} notFound.description
 * @property {string} notFound.homeLabel
 * @property {string} notFound.statusLabel
 * @property {Object} globalError - Global error page copy
 * @property {string} globalError.heading
 * @property {string} globalError.description
 * @property {string} globalError.reloadLabel
 * @property {string} globalError.homeLabel
 * @property {Object} invoiceTimeline - Invoice lifecycle timeline copy
 * @property {string} invoiceTimeline.heading
 * @property {string} invoiceTimeline.stageUploaded
 * @property {string} invoiceTimeline.stageVerified
 * @property {string} invoiceTimeline.stageListed
 * @property {string} invoiceTimeline.stageFunded
 * @property {string} invoiceTimeline.stageSettled
 * @property {string} invoiceTimeline.statusCompleted
 * @property {string} invoiceTimeline.statusCurrent
 * @property {string} invoiceTimeline.statusPending
 * @property {Object} setting
*/

const copy = {
  home: {
    heroTitle: 'Liquifact',
    heroSub: 'Invoice financing for modern businesses',
    boxBusinessTitle: 'For businesses',
    boxBusinessSub: 'Upload and tokenize your invoices',
    boxBusinessAriaLabel: 'Learn more about business invoice financing',
    boxInvestTitle: 'For investors',
    boxInvestSub: 'Fund invoices and earn yield',
    boxInvestAriaLabel: 'Learn more about investing in invoices',
    apiStatus: 'API status',
    checkApiHealth: 'Check API health',
    checking: 'Checking...',
    healthStatus: {
      connected: 'Connected',
      degraded: 'Degraded',
      unreachable: 'Unreachable',
      rawResponse: 'Raw response',
    },
  },
  invest: {},
  invoices: {},
  layout: {},
  footer: {},
  uploadZone: {},
  wallet: {},
  nav: {},
  error: {},
  network: {},
  notFound: {},
  globalError: {},
  invoiceTimeline: {},
  setting: {},
};

export default copy;
export { copy };
