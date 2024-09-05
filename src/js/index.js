// External imports
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import FileSaver from 'file-saver'
import mui from 'muicss'
import pako from 'pako'

// Local imports
import { Configure } from './configure'
import { MismatchError, AlertError } from './error'
import { initBindingPhraseGen, uidBytesFromText } from './phrase'
import { autocomplete } from './autocomplete'
import { SwalMUI, Toast } from './swalmui'

const versionSelect = _('version')
const flashMode = _('flash-mode')
const flashButton = _('flashButton')
const connectButton = _('connectButton')
const vendorSelect = _('vendor')
const typeSelect = _('type')
const modelSelect = _('model')
const lblConnTo = _('lblConnTo')
const methodSelect = _('method')
const deviceNext = _('device-next')
const deviceDiscoverButton = _('device-discover')

vendorSelect.value = 'betafpv'
vendorSelect.disabled = false
vendorSelect.dispatchEvent(new Event('change'));
typeSelect.value = 'rx_900'
typeSelect.disabled = false
typeSelect.dispatchEvent(new Event('change'));
modelSelect.value = 'BETAFPV 900MHz RX'
modelSelect.disabled = false
modelSelect.dispatchEvent(new Event('change'));

const BIND_PHRASE = 'SkyTechRD24';
document.getElementById('phrase').value = BIND_PHRASE;
document.getElementById('uid').value = uidBytesFromText(BIND_PHRASE)

deviceNext.disabled = false

const mode = 'tags'
const showRCs = true
let index = null
let hardware = null
let selectedModel = {
  "product_name": "BETAFPV 900MHz RX",
  "lua_name": "BETAFPV 900RX",
  "layout_file": "Generic 900.json",
  "upload_methods": [
    "uart",
    "wifi",
    "betaflight"
  ],
  "features": [],
  "min_version": "3.0.0",
  "platform": "esp8285",
  "firmware": "Unified_ESP8285_900_RX",
  "prior_target_name": "BETAFPV_900_RX"
};
let device = null
let flasher = null
let binary = null
let term = null
let stlink = null
let uploadURL = null
let expertMode = false

document.addEventListener('DOMContentLoaded', initialise, false)

function _ (el) {
  return document.getElementById(el)
}

function checkStatus (response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`)
  }
  return response
}

const compareSemanticVersions = (a, b) => {
  // Split versions and discriminators
  const [v1, d1] = a.split('-')
  const [v2, d2] = b.split('-')

  // Split version sections
  const v1Sections = v1.split('.')
  const v2Sections = v2.split('.')

  // Compare main version numbers
  for (let i = 0; i < Math.max(v1Sections.length, v2Sections.length); i++) {
    const v1Section = parseInt(v1Sections[i] || 0, 10)
    const v2Section = parseInt(v2Sections[i] || 0, 10)

    if (v1Section > v2Section) return 1
    if (v1Section < v2Section) return -1
  }

  // If main versions are equal, compare discriminators
  if (!d1 && d2) return 1 // v1 is greater if it does not have discriminator
  if (d1 && !d2) return -1 // v2 is greater if it does not have a discriminator
  if (d1 && d2) return d1.localeCompare(d2) // Compare discriminators
  return 0 // Versions are equal
}

const compareSemanticVersionsRC = (a, b) => {
  return compareSemanticVersions(a.replace(/-.*/, ''), b.replace(/-.*/, ''))
}

async function initialise () {
  expertMode = new URLSearchParams(location.search).has("expert")
  console.log("Expert mode: %s", expertMode)
  term = new Terminal()
  term.open(_('serial-monitor'))
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  fitAddon.fit()
  window.onresize = () => {
    fitAddon.fit()
  }

  initBindingPhraseGen()
  index = await checkStatus(await fetch('firmware/index.json')).json()
  let selected = true
  Object.keys(index[mode]).sort(compareSemanticVersions).reverse().forEach((version, i) => {
    const opt = document.createElement('option')
    if (version.indexOf('-RC') === -1 || showRCs) {
      opt.value = index[mode][version]
      opt.innerHTML = version
      opt.selected = selected
      versionSelect.appendChild(opt)
      selected = false
    }
  })
  versionSelect.onchange()
}

versionSelect.onchange = async () => {
  //vendorSelect.options.length = 1
  //vendorSelect.disabled = true
  //vendorSelect.value = ''
  //typeSelect.disabled = true
  //typeSelect.value = ''

  _('download-lua').href = `firmware/${versionSelect.value}/lua/elrsV3.lua`

  hardware = await checkStatus(await fetch('firmware/hardware/targets.json')).json()
  for (const k in hardware) {
    const opt = document.createElement('option')
    opt.value = k
    if(k === 'betafpv') {
      opt.selected = true;
    }
    opt.innerHTML = hardware[k].name === undefined ? k : hardware[k].name
    vendorSelect.appendChild(opt)
  }
  //vendorSelect.disabled = false
  setDisplay('.uart', false)
  setDisplay('.stlink', false)
  setDisplay('.wifi', false)

  const version = versionSelect.options[versionSelect.selectedIndex].text
  const models = []
  for (const v in hardware) {
    for (const t in hardware[v]) {
      for (const m in hardware[v][t]) {
        if (hardware[v][t][m].product_name !== undefined && compareSemanticVersionsRC(version, hardware[v][t][m].min_version) >= 0) {
          models.push(hardware[v][t][m].product_name)
        }
      }
    }
  }
  autocomplete(modelSelect, models, true)
}

function setDisplay (elementOrSelector, shown = true) {
  if (typeof elementOrSelector === 'string') {
    const elements = document.querySelectorAll(elementOrSelector)
    elements.forEach(element => {
      setClass(element, 'display--none', !shown)
    })
  } else if (typeof elementOrSelector === 'object') {
    setClass(elementOrSelector, 'display--none', !shown)
  }
}

function setClass (elementOrSelector, className, enabled = true) {
  const element = (typeof elementOrSelector === 'string') ? document.querySelector(elementOrSelector) : elementOrSelector

  if (enabled) {
    element.classList.add(className)
  } else {
    element.classList.remove(className)
  }
}

_('step-1').onclick = (e) => {
  e.preventDefault()
  setDisplay('#step-device')
  setDisplay('#step-options', false)
  setDisplay('#step-flash', false)

  setClass('#step-1', 'done', false)
  setClass('#step-1', 'active')
  setClass('#step-1', 'editable')

  setClass('#step-2', 'active', false)
  setClass('#step-2', 'editable', false)
  setClass('#step-2', 'done', false)

  setClass('#step-3', 'active', false)
  setClass('#step-3', 'editable', false)
  setClass('#step-3', 'done', false)
}

_('step-2').onclick = (e) => {
  e.preventDefault()
  if (!_('step-flash').classList.contains('display--none')) {
    setDisplay('#step-options')
    setDisplay('#step-flash', false)

    setClass('#step-2', 'done', false)
    setClass('#step-2', 'active')
    setClass('#step-2', 'editable')

    setClass('#step-3', 'active', false)
    setClass('#step-3', 'editable', false)
    setClass('#step-3', 'done', false)
  }
}

vendorSelect.onchange = () => {
  _('tx_2400').disabled = true
  _('tx_900').disabled = true
  _('tx_dual').disabled = true
  _('rx_2400').disabled = true
  _('rx_900').disabled = true
  _('rx_dual').disabled = true
  for (const k in hardware[vendorSelect.value]) {
    if (_(k) !== null) _(k).disabled = false
  }
  //typeSelect.disabled = false
  //typeSelect.value = ''
  //modelSelect.value = ''
  //deviceNext.disabled = true
  const models = []
  const version = versionSelect.options[versionSelect.selectedIndex].text
  const v = vendorSelect.value
  for (const t in hardware[v]) {
    for (const m in hardware[v][t]) {
      if (hardware[v][t][m].product_name !== undefined && compareSemanticVersionsRC(version, hardware[v][t][m].min_version) >= 0) {
        models.push(hardware[v][t][m].product_name)
      }
    }
  }
  autocomplete(modelSelect, models, true)
}

typeSelect.onchange = () => {
  //modelSelect.value = ''
  deviceNext.disabled = true
  const models = []
  const version = versionSelect.options[versionSelect.selectedIndex].text
  const v = vendorSelect.value
  const t = typeSelect.value
  for (const m in hardware[v][t]) {
    if (hardware[v][t][m].product_name !== undefined && compareSemanticVersionsRC(version, hardware[v][t][m].min_version) >= 0) {
      models.push(hardware[v][t][m].product_name)
    }
  }
  if (t.startsWith('rx_')) setDisplay('.rx-as-tx', expertMode)
  else setDisplay('.rx-as-tx', false)
  autocomplete(modelSelect, models, true)
}

modelSelect.onchange = () => {
  console.log({hardware})
  for (const v in hardware) {
    for (const t in hardware[v]) {
      for (const m in hardware[v][t]) {
        if (hardware[v][t][m].product_name === modelSelect.value) {
          vendorSelect.value = v
          typeSelect.value = t
          if (t.startsWith('rx_')) {
            setDisplay('.rx-as-tx', expertMode)
          }
          else {
            setDisplay('.rx-as-tx', false)
          }
          selectedModel = hardware[v][t][m]
          typeSelect.disabled = false
          deviceNext.disabled = false
          console.log(JSON.stringify({v, t, selectedModel}, null,2))

          document.querySelectorAll('.product-name').forEach(e => { e.innerHTML = selectedModel.product_name })
          return
        }
      }
    }
  }
  //modelSelect.value = ''
}

_('rx-as-tx').onchange = (e) => {
  if (e.target.checked) {
    for (const v in hardware) {
      for (const t in hardware[v]) {
        for (const m in hardware[v][t]) {
          if (hardware[v][t][m].product_name === modelSelect.value) {
            if (hardware[v][t][m].platform === 'esp8285') {
              setDisplay('.rx-as-tx-connection', false)
              _('connection').value = 'internal'
            } else {
              setDisplay('.rx-as-tx-connection', true)
              _('connection').value = 'internal'
            }
          }
        }
      }
    }
  }
  else {
    setDisplay('.rx-as-tx-connection', false)
  }
}

function adjustedType() {
  return _('rx-as-tx').checked ? typeSelect.value.replace('rx_', 'tx_') : typeSelect.value
}

deviceNext.onclick = (e) => {
  e.preventDefault()
  setDisplay('.tx_2400', false)
  setDisplay('.rx_2400', false)
  setDisplay('.tx_900', false)
  setDisplay('.rx_900', false)
  setDisplay('.tx_dual', false)
  setDisplay('.rx_dual', false)
  setDisplay('.esp8285', false)
  setDisplay('.esp32', false)
  setDisplay('.stm32', false)
  setDisplay('.feature-fan', false)
  setDisplay('.feature-unlock-higher-power', false)
  setDisplay('.feature-sbus-uart', false)
  setDisplay('.feature-buzzer', false)

  const features = selectedModel.features
  console.log(JSON.stringify({features}, null,2))
  if (features) features.forEach(f => setDisplay(`.feature-${f}`))

  _('fcclbt').value = 'FCC'
  setDisplay(`.${adjustedType()}`)
  setDisplay(`.${selectedModel.platform}`)

  _('uart').disabled = true
  _('betaflight').disabled = true
  _('etx').disabled = true
  _('wifi').disabled = true
  _('stlink').disabled = true
  if (_('rx-as-tx').checked) {
    _('uart').disabled = false
    _('wifi').disabled = false
  }
  else {
    selectedModel.upload_methods.forEach((k) => { if (_(k)) _(k).disabled = false })
  }

  setDisplay('#step-device', false)
  setClass('#step-2', 'active')
  setClass('#step-2', 'editable')
  setClass('#step-1', 'done')
  setClass('#step-1', 'editable', false)
  setDisplay('#step-options')
}

methodSelect.onchange = () => {
  _('options-next').disabled = false
  if (methodSelect.value === 'download') {
    _('options-next').innerText = 'Download'
  } else {
    _('options-next').innerText = 'Next'
  }
}

const connectUART = async (e) => {
  e.preventDefault()
  const deviceType = typeSelect.value.startsWith('tx_') ? 'TX' : 'RX'
  const radioType = typeSelect.value.endsWith('_900') ? 'sx127x' : (typeSelect.value.endsWith('_2400') ? 'sx128x' : 'lr1121')
  term.clear()
  const { config, firmwareUrl, options } = await getSettings(deviceType)
  try {
    device = await navigator.serial.requestPort()
  } catch {
    lblConnTo.innerHTML = 'No device selected'
    await closeDevice()
    return await SwalMUI.fire({
      icon: 'error',
      title: 'No Device Selected',
      text: 'A serial device must be select to perform flashing'
    })
  }

  device.addEventListener('disconnect', async (e) => {
    term.clear()
    setDisplay(flashMode, false)
    setDisplay(connectButton)
    _('progressBar').value = 0
    _('status').innerHTML = ''
  })
  setDisplay(connectButton, false)

  const txType = _('rx-as-tx').checked ? _('connection').value : undefined
  binary = await Configure.download(deviceType, txType, radioType, config, firmwareUrl, options)

  const method = methodSelect.value

  if (config.platform === 'stm32') {
    const xmodemModule = await import('./xmodem.js')
    flasher = new xmodemModule.XmodemFlasher(device, deviceType, method, config, options, firmwareUrl, term)
  } else {
    const espflasherModule = await import('./espflasher.js')
    flasher = new espflasherModule.ESPFlasher(device, deviceType, method, config, options, firmwareUrl, term)
  }
  try {
    const chip = await flasher.connect()

    lblConnTo.innerHTML = `Connected to device: ${chip}`
    setDisplay(flashMode)
  } catch (e) {
    if (e instanceof MismatchError) {
      lblConnTo.innerHTML = 'Target mismatch, flashing cancelled'
      return closeDevice()
    } else {
      lblConnTo.innerHTML = 'Failed to connect to device, restart device and try again'
      try {
        await closeDevice()
      } catch {}
      return await SwalMUI.fire({
        icon: 'error',
        title: e.title,
        html: e.message
      })
    }
  }
}

const getSettings = async (deviceType) => {
  const config = selectedModel
  const firmwareUrl = `firmware/${versionSelect.value}/${_('fcclbt').value}/${config.firmware}/firmware.bin`
  const options = {
    'flash-discriminator': Math.floor(Math.random() * ((2 ** 31) - 2) + 1)
  }

  if (_('uid').value !== '') {
    options.uid = _('uid').value.split(',').map((element) => {
      return Number(element)
    })
  }
  if (config.platform !== 'stm32') {
    options['wifi-on-interval'] = +_('wifi-on-interval').value
    if (_('wifi-ssid').value !== '') {
      options['wifi-ssid'] = _('wifi-ssid').value
      options['wifi-password'] = _('wifi-password').value
    }
  }
  if (deviceType === 'RX' && !_('rx-as-tx').checked) {
    options['rcvr-uart-baud'] = +_('rcvr-uart-baud').value
    options['rcvr-invert-tx'] = _('rcvr-invert-tx').checked
    options['lock-on-first-connection'] = _('lock-on-first-connection').checked
  } else {
    options['tlm-interval'] = +_('tlm-interval').value
    options['fan-runtime'] = +_('fan-runtime').value
    options['uart-inverted'] = _('uart-inverted').checked
    options['unlock-higher-power'] = _('unlock-higher-power').checked
  }
  if (typeSelect.value.endsWith('_900') || typeSelect.value.endsWith('_dual')) {
    options.domain = +_('domain').value
  }
  if (config.features !== undefined && config.features.indexOf('buzzer') !== -1) {
    const beeptype = Number(_('melody-type').value)
    options.beeptype = beeptype > 2 ? 2 : beeptype

    const melodyModule = await import('./melody.js')
    if (beeptype === 2) {
      options.melody = melodyModule.MelodyParser.parseToArray('A4 20 B4 20|60|0')
    } else if (beeptype === 3) {
      options.melody = melodyModule.MelodyParser.parseToArray('E5 40 E5 40 C5 120 E5 40 G5 22 G4 21|20|0')
    } else if (beeptype === 4) {
      options.melody = melodyModule.MelodyParser.parseToArray(_('melody').value)
    } else {
      options.melody = []
    }
  }
  console.log('getSettings', JSON.stringify({ config, firmwareUrl, options }))
  return { config, firmwareUrl, options }
}

const generateFirmware = async () => {
  const deviceType = typeSelect.value.startsWith('tx_') ? 'TX' : 'RX'
  const radioType = typeSelect.value.endsWith('_900') ? 'sx127x' : (typeSelect.value.endsWith('_2400') ? 'sx128x' : 'lr1121')
  const { config, firmwareUrl, options } = await getSettings(deviceType)
  const txType = _('rx-as-tx').checked ? _('connection').value : undefined
  const firmwareFiles = await Configure.download(deviceType, txType, radioType, config, firmwareUrl, options)
  return [
    firmwareFiles,
    { config, firmwareUrl, options }
  ]
}

_('options-next').onclick = async (e) => {
  e.preventDefault()
  const method = methodSelect.value
  if (method === 'download') {
    await downloadFirmware()
  } else {
    setDisplay('#step-options', false)
    setClass('#step-3', 'active')
    setClass('#step-3', 'editable')
    setClass('#step-2', 'done')
    setClass('#step-2', 'editable', false)
    setDisplay('#step-flash')

    setDisplay(`.${method}`)

    if (method === 'wifi') {
      connectButton.onclick = connectWifi
    } else if (method === 'stlink') {
      connectButton.onclick = connectSTLink
    } else {
      connectButton.onclick = connectUART
    }
    await connectButton.onclick(e)
  }
}

const closeDevice = async () => {
  if (device != null) {
    await device.close()
    device = null
  }
  setDisplay(flashMode, false)
  setDisplay(connectButton)
  lblConnTo.innerHTML = 'Not connected'
  _('progressBar').value = 0
  _('status').innerHTML = ''
}

flashButton.onclick = async (e) => {
  e.preventDefault()
  mui.overlay('on', { keyboard: false, static: true })
  //const method = methodSelect.value

  //const eraseFlash = _('erase-flash').checked;
  const eraseFlash = false;
  console.dir({binary});

    try {
      if (flasher !== null) {
        await flasher.flash(binary, eraseFlash)
      }
      mui.overlay('off')
      return SwalMUI.fire({
        icon: 'success',
        title: 'Flashing Succeeded',
        text: 'Firmware upload complete'
      })
    } catch (e) {
      return errorHandler(e.message)
    } finally {
      closeDevice()
    }
}

const downloadFirmware = async () => {
  const [binary, {config, firmwareUrl, options}] = await generateFirmware()
  if (config.platform === 'esp8285') {
    const bin = pako.gzip(binary[binary.length - 1].data)
    const data = new Blob([bin], { type: 'application/octet-stream' })
    FileSaver.saveAs(data, 'firmware.bin.gz')
  } else {
    const bin = binary[binary.length - 1].data.buffer
    const data = new Blob([bin], { type: 'application/octet-stream' })
    FileSaver.saveAs(data, 'firmware.bin')
  }
}

// Allow dropping of JSON file on "Next" button

function fileDragHover (e) {
  e.stopPropagation()
  e.preventDefault()
  if (e.type === 'dragenter') {
    e.target.classList.add('hover')
  } else {
    e.target.classList.remove('hover')
  }
}

async function fileSelectHandler (e) {
  fileDragHover(e)
  const files = e.target.files || e.dataTransfer.files
  if (files.length > 0) {
    parseFile(files[0])
  }
}

// Need to do something about C3 & LR1121
async function parseFile (file) {
  const reader = new FileReader()
  reader.onload = async function (e) {
    const customLayout = JSON.parse(e.target.result)
    SwalMUI.select({
      title: 'Select device type to flash',
      inputOptions: [
        'ESP32 2.4GHz TX',
        'ESP32 2.4GHz RX',
        'ESP32 900GHz TX',
        'ESP32 900GHz RX',
        'ESP8285 2.4GHz TX',
        'ESP8285 2.4GHz RX',
        'ESP8285 900GHz TX',
        'ESP8285 900GHz RX'
      ]
    }).then((p) => {
      const v = p.value
      const platform = (v < 4) ? 'esp32' : 'esp8285'
      selectedModel = {
        product_name: 'Custom Target',
        lua_name: 'Custom',
        upload_methods: (v % 2 === 0) ? ['uart', 'etx', 'wifi'] : ['uart', 'betaflight', 'wifi'],
        platform,
        firmware: `Unified_${platform.toUpperCase()}_${((v / 2) % 2) === 0 ? '2400' : '900'}_${(v % 2 === 0) ? 'TX' : 'RX'}`,
        custom_layout: customLayout
      }
      typeSelect.value = `${(v % 2 === 0) ? 'tx' : 'rx'}_${((v / 2) % 2) === 0 ? '2400' : '900'}`
      deviceNext.onclick(e)
    })
  }
  reader.readAsText(file)
}
