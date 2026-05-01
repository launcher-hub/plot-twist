// [VN-ErrorCatch] Global error handlers to surface silent crashes
window.addEventListener('error', (event) => {
    console.error('[VN-ErrorCatch] Uncaught error:', event.error || event.message, event)
})
window.addEventListener('unhandledrejection', (event) => {
    console.error('[VN-ErrorCatch] Unhandled rejection:', event.reason, event)
})
/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

function createSafeLogger(label) {
    const prefix = `[${label}]`
    let logger = null

    try {
        logger = LoggerUtil.getLogger(label)
    } catch (error) {
        console.error(`${prefix} Failed to initialize logger from LoggerUtil.`, error)
    }

    const makeSafe = (methodName, fallback) => {
        const method = logger?.[methodName]
        if (typeof method === 'function') {
            return method.bind(logger)
        }
        return (...args) => fallback(prefix, ...args)
    }

    if (logger && (typeof logger.info !== 'function' || typeof logger.error !== 'function' || typeof logger.debug !== 'function')) {
        console.warn(`${prefix} LoggerUtil returned invalid logger methods, falling back as needed.`, {
            logger,
            infoType: typeof logger?.info,
            errorType: typeof logger?.error,
            debugType: typeof logger?.debug,
        })
    }

    return {
        info: makeSafe('info', console.log),
        error: makeSafe('error', console.error),
        debug: makeSafe('debug', console.debug),
    }
}

const loggerUICore             = createSafeLogger('UICore')
const loggerAutoUpdater        = createSafeLogger('AutoUpdater')
function safeAutoUpdaterLog(level, ...args) {
    if (loggerAutoUpdater && typeof loggerAutoUpdater[level] === 'function') {
        loggerAutoUpdater[level](...args)
        return
    }
    const printer = level === 'error' ? console.error : level === 'debug' ? console.debug : console.log
    printer('[AutoUpdater]', ...args)
}
console.log('[AutoUpdater debug] loggerAutoUpdater initialized', {
    loggerType: typeof loggerAutoUpdater,
    infoType: typeof loggerAutoUpdater.info,
    errorType: typeof loggerAutoUpdater.error,
    debugType: typeof loggerAutoUpdater.debug,
    loggerAutoUpdater,
})

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        console.log('[AutoUpdater debug] autoUpdateNotification', arg, info, {
            loggerType: typeof loggerAutoUpdater,
            infoType: typeof loggerAutoUpdater?.info,
            errorType: typeof loggerAutoUpdater?.error,
            debugType: typeof loggerAutoUpdater?.debug,
            loggerAutoUpdater,
        })
        switch(arg){
            case 'checking-for-update':
                safeAutoUpdaterLog('info', 'Checking for update..')
                ;(typeof settingsUpdateButtonStatus === 'function') && settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
                break
            case 'update-available':
                safeAutoUpdaterLog('info', 'New update available', info.version)
                
                if(process.platform === 'darwin'){
                    info.darwindownload = `https://github.com/dscalzi/HeliosLauncher/releases/download/v${info.version}/Helios-Launcher-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                    showUpdateUI(info)
                }
                
                ;(typeof populateSettingsUpdateInformation === 'function') && populateSettingsUpdateInformation(info)
                break
            case 'update-downloaded':
                safeAutoUpdaterLog('info', 'Update ' + info.version + ' ready to be installed.')
                ;(typeof settingsUpdateButtonStatus === 'function') && settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, () => {
                    if(!isDev){
                        ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
                    }
                })
                showUpdateUI(info)
                break
            case 'update-not-available':
                safeAutoUpdaterLog('info', 'No new update found.')
                ;(typeof settingsUpdateButtonStatus === 'function') && settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            case 'ready':
                updateCheckListener = setInterval(() => {
                    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                }, 1800000)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                break
            case 'realerror':
                if(info != null && info.code != null){
                    if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                        safeAutoUpdaterLog('info', 'No suitable releases found.')
                    } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                        safeAutoUpdaterLog('info', 'No releases found.')
                    } else {
                        safeAutoUpdaterLog('error', 'Error during update check..', info)
                        safeAutoUpdaterLog('debug', 'Error Code:', info.code)
                    }
                }
                break
            default:
                safeAutoUpdaterLog('info', 'Unknown argument', arg)
                break
        }
    })
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function showUpdateUI(info){
    //TODO Make this message a bit more informative `${info.version}`
    document.getElementById('image_seal_container').setAttribute('update', true)
    document.getElementById('image_seal_container').onclick = () => {
        /*setOverlayContent('Update Available', 'A new update for the launcher is available. Would you like to install now?', 'Install', 'Later')
        setOverlayHandler(() => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
            } else {
                console.error('Cannot install updates in development environment.')
                toggleOverlay(false)
            }
        })
        setDismissHandler(() => {
            toggleOverlay(false)
        })
        toggleOverlay(true, true)*/
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            settingsNavItemListener(document.getElementById('settingsNavUpdate'), false)
        })
    }
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        document.getElementById('launch_details').style.maxWidth = 266.01
        document.getElementById('launch_progress').style.width = 170.8
        document.getElementById('launch_details_right').style.maxWidth = 170.8
        document.getElementById('launch_progress_label').style.width = 53.21
        
    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})