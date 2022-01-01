/**
 * Numerous tools for working with the editor's "canvas".
 * @module svgcanvas
 *
 * @license MIT
 *
 * @copyright 2010 Alexis Deveria, 2010 Pavol Rusnak, 2010 Jeff Schiller, 2021 OptimistikSAS
 *
 */

import { Canvg as canvg } from 'canvg'
import 'pathseg' // SVGPathSeg Polyfill (see https://github.com/progers/pathseg)

import * as pathModule from './path.js'
import * as history from './history.js'
import * as draw from './draw.js'
import {
  init as pasteInit, pasteElementsMethod
} from './paste-elem.js'
import { svgRootElement } from './svgroot.js'
import {
  init as undoInit, changeSelectedAttributeNoUndoMethod,
  changeSelectedAttributeMethod
} from './undo.js'
import {
  init as selectionInit, clearSelectionMethod, addToSelectionMethod, getMouseTargetMethod,
  getIntersectionListMethod, runExtensionsMethod, groupSvgElem, prepareSvg,
  recalculateAllSelectedDimensions, setRotationAngle
} from './selection.js'
import {
  init as textActionsInit, textActionsMethod
} from './text-actions.js'
import {
  init as eventInit, mouseMoveEvent, mouseUpEvent, mouseOutEvent,
  dblClickEvent, mouseDownEvent, DOMMouseScrollEvent
} from './event.js'
import { init as jsonInit, getJsonFromSvgElements, addSVGElementsFromJson } from './json.js'
import * as elemGetSet from './elem-get-set.js'
import {
  init as selectedElemInit, moveToTopSelectedElem, moveToBottomSelectedElem,
  moveUpDownSelected, moveSelectedElements, cloneSelectedElements, alignSelectedElements,
  deleteSelectedElements, copySelectedElements, groupSelectedElements, pushGroupProperty,
  ungroupSelectedElement, cycleElement, updateCanvas
} from './selected-elem.js'
import {
  init as blurInit, setBlurNoUndo, setBlurOffsets, setBlur
} from './blur-event.js'
import { sanitizeSvg } from './sanitize.js'
import { getReverseNS, NS } from './namespaces.js'
import {
  assignAttributes, cleanupElement, getElement, getUrlFromAttr,
  findDefs, getHref, setHref, getRefElem, getRotationAngle,
  getBBoxOfElementAsPath, convertToPath, encode64, decode64,
  getVisibleElements, init as utilsInit,
  getBBox as utilsGetBBox, getStrokedBBoxDefaultVisible, isNullish, blankPageObjectURL,
  $id, $qa, $qq, getFeGaussianBlur, stringToHTML, insertChildAtIndex
} from './utilities.js'
import {
  matrixMultiply, hasMatrixTransform, transformListToTransform
} from './math.js'
import {
  convertToNum, init as unitsInit, getTypeMap
} from '../common/units.js'
import {
  svgCanvasToString, svgToString, setSvgString, exportPDF, setUseDataMethod,
  init as svgInit, importSvgString, embedImage, rasterExport,
  uniquifyElemsMethod, removeUnusedDefElemsMethod, convertGradientsMethod
} from './svg-exec.js'
import {
  remapElement,
  init as coordsInit
} from './coords.js'
import {
  recalculateDimensions,
  init as recalculateInit
} from './recalculate.js'
import {
  getSelectorManager,
  Selector,
  init as selectInit
} from './select.js'
import {
  clearSvgContentElementInit,
  init as clearInit
} from './clear.js'
import {
  getClosest, getParents, mergeDeep
} from '../editor/components/jgraduate/Util.js'

import dataStorage from './dataStorage.js'

const visElems = 'a,circle,ellipse,foreignObject,g,image,line,path,polygon,polyline,rect,svg,text,tspan,use'
const refAttrs = ['clip-path', 'fill', 'filter', 'marker-end', 'marker-mid', 'marker-start', 'mask', 'stroke']

const THRESHOLD_DIST = 0.8
const STEP_COUNT = 10
const CLIPBOARD_ID = 'svgedit_clipboard'

/**
* The main SvgCanvas class that manages all SVG-related functions.
* @memberof module:svgcanvas
*
*/
class SvgCanvas {
  /**
  * @param {HTMLElement} container - The container HTML element that should hold the SVG root element
  * @param {module:SVGeditor.configObj.curConfig} config - An object that contains configuration data
  */
  constructor (container, config) {
    // imported function made available as methods
    this.initializeSvgCanvasMethods()
    const { pathActions } = pathModule

    // initialize class variables
    this.saveOptions = { round_digits: 5 } // Object with save options
    this.importIds = {} // Object with IDs for imported files, to see if one was already added
    this.extensions = {} // Object to contain all included extensions
    this.removedElements = {} // Map of deleted reference elements
    this.started = false // Boolean indicating whether or not a draw action has been this.started
    this.startTransform = null // String with an element's initial transform attribute value
    this.currentMode = 'select' // String indicating the current editor mode
    this.currentResizeMode = 'none' // String with the current direction in which an element is being resized
    this.justSelected = null // The DOM element that was just selected
    this.rubberBox = null // DOM element for selection rectangle drawn by the user
    this.curBBoxes = [] // Array of current BBoxes, used in getIntersectionList().
    this.lastClickPoint = null // Canvas point for the most recent right click
    this.events = {} // Object to contain editor event names and callback functions
    this.rootSctm = null // Root Current Transformation Matrix in user units
    this.drawnPath = null
    this.freehand = { // Mouse events
      minx: null,
      miny: null,
      maxx: null,
      maxy: null
    }
    this.dAttr = null
    this.startX = null
    this.startY = null
    this.rStartX = null
    this.rStartY = null
    this.initBbox = {}
    this.sumDistance = 0
    this.controllPoint2 = { x: 0, y: 0 }
    this.controllPoint1 = { x: 0, y: 0 }
    this.start = { x: 0, y: 0 }
    this.end = { x: 0, y: 0 }
    this.bSpline = { x: 0, y: 0 }
    this.nextPos = { x: 0, y: 0 }
    this.idprefix = 'svg_' // Prefix string for element IDs
    this.encodableImages = {}

    this.curConfig = { // Default configuration options
      show_outside_canvas: true,
      selectNew: true,
      dimensions: [640, 480]
    }
    // Update config with new one if given
    if (config) {
      this.curConfig = SvgCanvas.mergeDeep(this.curConfig, config)
    }
    this.lastGoodImgUrl = `${this.curConfig.imgPath}/logo.svg` // String with image URL of last loadable image
    const { dimensions } = this.curConfig // Array with width/height of canvas

    // "document" element associated with the container (same as window.document using default svg-editor.js)
    // NOTE: This is not actually a SVG document, but an HTML document.
    this.svgdoc = window.document
    this.container = container
    // This is a container for the document being edited, not the document itself.
    this.svgroot = svgRootElement(this.svgdoc, dimensions)
    container.append(this.svgroot)
    // The actual element that represents the final output SVG element.
    this.svgContent = this.svgdoc.createElementNS(NS.SVG, 'svg')
    clearInit(this)
    this.clearSvgContentElement()
    // Current `draw.Drawing` object.
    this.current_drawing_ = new draw.Drawing(this.svgContent, this.idprefix)
    // Float displaying the current zoom level (1 = 100%, .5 = 50%, etc.).
    this.zoom = 1

    // pointer to current group (for in-group editing)
    this.currentGroup = null

    // Object containing data for the currently selected styles
    const allProperties = {
      shape: {
        fill: (this.curConfig.initFill.color === 'none' ? '' : '#') + this.curConfig.initFill.color,
        fill_paint: null,
        fill_opacity: this.curConfig.initFill.opacity,
        stroke: '#' + this.curConfig.initStroke.color,
        stroke_paint: null,
        stroke_opacity: this.curConfig.initStroke.opacity,
        stroke_width: this.curConfig.initStroke.width,
        stroke_dasharray: 'none',
        stroke_linejoin: 'miter',
        stroke_linecap: 'butt',
        opacity: this.curConfig.initOpacity
      }
    }
    allProperties.text = SvgCanvas.mergeDeep({}, allProperties.shape)
    allProperties.text = SvgCanvas.mergeDeep(allProperties.text, {
      fill: '#000000',
      stroke_width: this.curConfig.text && this.curConfig.text.stroke_width,
      font_size: this.curConfig.text && this.curConfig.text.font_size,
      font_family: this.curConfig.text && this.curConfig.text.font_family
    })
    this.curText = allProperties.text // Current text style properties

    // Current shape style properties
    this.curShape = allProperties.shape
    this.curProperties = this.curShape // Current general properties

    // Array with all the currently selected elements
    // default size of 1 until it needs to grow bigger
    this.selectedElements = []

    jsonInit(this)
    unitsInit(this)
    utilsInit(this)
    coordsInit(this)
    recalculateInit(this)
    selectInit(this)
    undoInit(this)
    selectionInit(this)

    this.nsMap = getReverseNS()
    this.selectorManager = getSelectorManager()

    this.pathActions = pathActions
    pathModule.init(this)
    // Interface strings, usually for title elements
    this.uiStrings = {}

    // Animation element to change the opacity of any newly created element
    this.opacAni = document.createElementNS(NS.SVG, 'animate')
    this.opacAni.setAttribute('attributeName', 'opacity')
    this.opacAni.setAttribute('begin', 'indefinite')
    this.opacAni.setAttribute('dur', 1)
    this.opacAni.setAttribute('fill', 'freeze')
    this.svgroot.appendChild(this.opacAni)

    eventInit(this)
    textActionsInit(this)
    svgInit(this)
    draw.init(this)
    elemGetSet.init(this)

    // prevent links from being followed in the canvas
    const handleLinkInCanvas = function (e) {
      e.preventDefault()
      return false
    }
    container.addEventListener('mousedown', mouseDownEvent)
    container.addEventListener('mousemove', mouseMoveEvent)
    container.addEventListener('click', handleLinkInCanvas)
    container.addEventListener('dblclick', dblClickEvent)
    container.addEventListener('mouseup', mouseUpEvent)
    container.addEventListener('mouseleave', mouseOutEvent)
    container.addEventListener('mousewheel', DOMMouseScrollEvent)
    container.addEventListener('DOMMouseScroll', DOMMouseScrollEvent)

    // Alias function
    this.linkControlPoints = pathActions.linkControlPoints
    this.curCommand = null
    this.filter = null
    this.filterHidden = false

    blurInit(this)
    selectedElemInit(this)

    /**
* Transfers sessionStorage from one tab to another.
* @param {!Event} ev Storage event.
* @returns {void}
*/
    const storageChange = (ev) => {
      if (!ev.newValue) return // This is a call from removeItem.
      if (ev.key === CLIPBOARD_ID + '_startup') {
        // Another tab asked for our sessionStorage.
        localStorage.removeItem(CLIPBOARD_ID + '_startup')
        this.flashStorage()
      } else if (ev.key === CLIPBOARD_ID) {
        // Another tab sent data.
        sessionStorage.setItem(CLIPBOARD_ID, ev.newValue)
      }
    }

    // Listen for changes to localStorage.
    window.addEventListener('storage', storageChange, false)
    // Ask other tabs for sessionStorage (this is ONLY to trigger event).
    localStorage.setItem(CLIPBOARD_ID + '_startup', Math.random())

    pasteInit(this)

    this.contentW = this.getResolution().w
    this.contentH = this.getResolution().h
    this.clear()
  } // End constructor

  getSvgOption () { return this.saveOptions }
  setSvgOption (key, value) { this.saveOptions[key] = value }
  getSelectedElements () { return this.selectedElements }
  setSelectedElements (key, value) { this.selectedElements[key] = value }
  setEmptySelectedElements () { this.selectedElements = [] }
  getSvgRoot () { return this.svgroot } // @returns {SVGSVGElement} The root DOM element
  getDOMDocument () { return this.svgdoc }
  getDOMContainer () { return this.container }
  getCurConfig () { return this.curConfig }
  setIdPrefix (p) { this.idprefix = p }
  getCurrentDrawing () { return this.current_drawing_ }
  getCurShape () { return this.curShape }
  getCurrentGroup () { return this.currentGroup }
  getBaseUnit () { return this.curConfig.baseUnit }
  getHeight () { return this.svgContent.getAttribute('height') / this.zoom }
  getWidth () { return this.svgContent.getAttribute('width') / this.zoom }
  getRoundDigits () { return this.saveOptions.round_digits }
  getSnappingStep () { return this.curConfig.snappingStep }
  getGridSnapping () { return this.curConfig.gridSnapping }
  getStartTransform () { return this.startTransform }
  setStartTransform (transform) { this.startTransform = transform }
  getZoom () { return this.zoom }
  round (val) { return Number.parseInt(val * this.zoom) / this.zoom }
  createSVGElement (jsonMap) { return this.addSVGElementsFromJson(jsonMap) }
  getContainer () { return this.container }
  setStarted (s) { this.started = s }
  getRubberBox () { return this.rubberBox }
  setRubberBox (rb) {
    this.rubberBox = rb
    return this.rubberBox
  }

  addPtsToSelection ({ closedSubpath, grips }) {
    // TODO: Correct this:
    this.pathActions.canDeleteNodes = true
    this.pathActions.closed_subpath = closedSubpath
    this.call('pointsAdded', { closedSubpath, grips })
    this.call('selected', grips)
  }

  /**
   * @param {PlainObject} changes
   * @param {ChangeElementCommand} changes.cmd
   * @param {SVGPathElement} changes.elem
   * @fires module:svgcanvas.SvgCanvas#event:changed
   * @returns {void}
   */
  endChanges ({ cmd, elem }) {
    this.addCommandToHistory(cmd)
    this.call('changed', [elem])
  }

  getCurrentMode () { return this.currentMode }
  setCurrentMode (cm) {
    this.currentMode = cm
    return this.currentMode
  }

  getDrawnPath () { return this.drawnPath }
  setDrawnPath (dp) {
    this.drawnPath = dp
    return this.drawnPath
  }

  setCurrentGroup (cg) { this.currentGroup = cg }
  changeSvgContent () { this.call('changed', [this.svgContent]) }
  getStarted () { return this.started }
  getCanvas () { return this }
  getrootSctm () { return this.rootSctm }
  getStartX () { return this.startX }
  setStartX (value) { this.startX = value }
  getStartY () { return this.startY }
  setStartY (value) { this.startY = value }
  getRStartX () { return this.rStartX }
  getRStartY () { return this.rStartY }
  getInitBbox () { return this.initBbox }
  getCurrentResizeMode () { return this.currentResizeMode }
  getJustSelected () { return this.justSelected }
  getOpacAni () { return this.opacAni }
  getParameter () { return this.parameter }
  getNextParameter () { return this.nextParameter }
  getStepCount () { return STEP_COUNT }
  getThreSholdDist () { return THRESHOLD_DIST }
  getSumDistance () { return this.sumDistance }
  getStart (key) { return this.start[key] }
  getEnd (key) { return this.end[key] }
  getbSpline (key) { return this.bSpline[key] }
  getNextPos (key) { return this.nextPos[key] }
  getControllPoint1 (key) { return this.controllPoint1[key] }
  getControllPoint2 (key) { return this.controllPoint2[key] }
  getFreehand (key) { return this.freehand[key] }
  getDrawing () { return this.getCurrentDrawing() }
  getDAttr () { return this.dAttr }
  getLastGoodImgUrl () { return this.lastGoodImgUrl }
  getCurText (key) { return this.curText[key] }
  setDAttr (value) { this.dAttr = value }
  setEnd (key, value) { this.end[key] = value }
  setControllPoint1 (key, value) { this.controllPoint1[key] = value }
  setControllPoint2 (key, value) { this.controllPoint2[key] = value }
  setJustSelected (value) { this.justSelected = value }
  setParameter (value) { this.parameter = value }
  setStart (value) { this.start = value }
  setRStartX (value) { this.rStartX = value }
  setRStartY (value) { this.rStartY = value }
  setSumDistance (value) { this.sumDistance = value }
  setbSpline (value) { this.bSpline = value }
  setNextPos (value) { this.nextPos = value }
  setNextParameter (value) { this.nextParameter = value }
  setCurProperties (key, value) { this.curProperties[key] = value }
  setCurText (key, value) { this.curText[key] = value }
  setFreehand (key, value) { this.freehand[key] = value }
  setCurBBoxes (value) { this.curBBoxes = value }
  getCurBBoxes () { return this.curBBoxes }
  setInitBbox (value) { this.initBbox = value }
  setRootSctm (value) { this.rootSctm = value }
  setCurrentResizeMode (value) { this.currentResizeMode = value }
  getLastClickPoint (key) { return this.lastClickPoint[key] }
  setLastClickPoint (value) { this.lastClickPoint = value }
  getId () { return this.getCurrentDrawing().getId() }
  getUIStrings () { return this.uiStrings }
  getNsMap () { return this.nsMap }
  getSvgOptionApply () { return this.saveOptions.apply }
  getSvgOptionImages () { return this.saveOptions.images }
  getEncodableImages (key) { return this.encodableImages[key] }
  setEncodableImages (key, value) { this.encodableImages[key] = value }
  getVisElems () { return visElems }
  getIdPrefix () { return this.idprefix }
  getDataStorage () { return dataStorage }
  setZoom (value) { this.zoom = value }
  getImportIds (key) { return this.importIds[key] }
  setImportIds (key, value) { this.importIds[key] = value }
  setRemovedElements (key, value) { this.removedElements[key] = value }
  setSvgContent (value) { this.svgContent = value }
  getrefAttrs () { return refAttrs }
  getcanvg () { return canvg }
  setCanvas (key, value) { this[key] = value }
  getCurProperties (key) { return this.curProperties[key] }
  setCurShape (key, value) { this.curShape[key] = value }
  gettingSelectorManager () { return this.selectorManager }
  getContentW () { return this.contentW }
  getContentH () { return this.contentH }
  getClipboardID () { return CLIPBOARD_ID }
  getSvgContent () { return this.svgContent }
  getExtensions () { return this.extensions }
  getSelector () { return Selector }
  getMode () { return this.currentMode } // The current editor mode string
  getNextId () { return this.getCurrentDrawing().getNextId() }
  getCurCommand () { return this.curCommand }
  setCurCommand (value) { this.curCommand = value }
  getFilter () { return this.filter }
  setFilter (value) { this.filter = value }
  getFilterHidden () { return this.filterHidden }
  setFilterHidden (value) { this.filterHidden = value }
  /**
  * Sets the editor's mode to the given string.
  * @function module:svgcanvas.SvgCanvas#setMode
  * @param {string} name - String with the new mode to change to
  * @returns {void}
  */
  setMode (name) {
    this.pathActions.clear(true)
    this.textActions.clear()
    this.curProperties = (this.selectedElements[0] && this.selectedElements[0].nodeName === 'text') ? this.curText : this.curShape
    this.currentMode = name
  }

  /**
  * Clears the current document. This is not an undoable action.
  * @function module:svgcanvas.SvgCanvas#clear
  * @fires module:svgcanvas.SvgCanvas#event:cleared
  * @returns {void}
  */
  clear () {
    this.pathActions.clear()
    this.clearSelection()
    // clear the svgcontent node
    this.clearSvgContentElement()
    // create new document
    this.current_drawing_ = new draw.Drawing(this.svgContent)
    // create empty first layer
    this.createLayer('Layer 1')
    // clear the undo stack
    this.undoMgr.resetUndoStack()
    // reset the selector manager
    this.selectorManager.initGroup()
    // reset the rubber band box
    this.rubberBox = this.selectorManager.getRubberBandBox()
    this.call('cleared')
  }

  runExtension (name, action, vars) {
    return this.runExtensions(action, vars, false, (n) => n === name)
  }

  async addExtension (name, extInitFunc, { importLocale }) {
    if (typeof extInitFunc !== 'function') {
      throw new TypeError('Function argument expected for `svgcanvas.addExtension`')
    }
    if (name in this.extensions) {
      throw new Error('Cannot add extension "' + name + '", an extension by that name already exists.')
    }
    const argObj = {
      importLocale,
      svgroot: this.svgroot,
      svgContent: this.svgContent,
      nonce: this.getCurrentDrawing().getNonce(),
      selectorManager: this.selectorManager
    }
    const extObj = await extInitFunc(argObj)
    if (extObj) {
      extObj.name = name
    }
    this.extensions[name] = extObj
    return this.call('extension_added', extObj)
  }

  addCommandToHistory (cmd) { this.undoMgr.addCommandToHistory(cmd) }
  restoreRefElements (elem) {
    // Look for missing reference elements, restore any found
    const attrs = {}
    refAttrs.forEach(function (item, _) {
      attrs[item] = elem.getAttribute(item)
    })
    Object.values(attrs).forEach((val) => {
      if (val && val.startsWith('url(')) {
        const id = getUrlFromAttr(val).substr(1)
        const ref = getElement(id)
        if (!ref) {
          findDefs().append(this.removedElements[id])
          delete this.removedElements[id]
        }
      }
    })
    const childs = elem.getElementsByTagName('*')

    if (childs.length) {
      for (let i = 0, l = childs.length; i < l; i++) {
        this.restoreRefElements(childs[i])
      }
    }
  }

  call (ev, arg) {
    if (this.events[ev]) {
      return this.events[ev](window, arg)
    }
    return undefined
  }

  /**
  * Attaches a callback function to an event.
  * @function module:svgcanvas.SvgCanvas#bind
  * @param  {string} ev - String indicating the name of the event
  * @param {module:svgcanvas.EventHandler} f - The callback function to bind to the event
  * @returns {module:svgcanvas.EventHandler} The previous event
  */
  bind (ev, f) {
    const old = this.events[ev]
    this.events[ev] = f
    return old
  }

  /**
* Flash the clipboard data momentarily on localStorage so all tabs can see.
* @returns {void}
*/
  flashStorage () {
    const data = sessionStorage.getItem(CLIPBOARD_ID)
    localStorage.setItem(CLIPBOARD_ID, data)
    setTimeout(function () {
      localStorage.removeItem(CLIPBOARD_ID)
    }, 1)
  }

  /**
  * Selects only the given elements, shortcut for `clearSelection(); addToSelection()`.
  * @function module:svgcanvas.SvgCanvas#selectOnly
  * @param {Element[]} elems - an array of DOM elements to be selected
  * @param {boolean} showGrips - Indicates whether the resize grips should be shown
  * @returns {void}
  */
  selectOnly (elems, showGrips) {
    this.clearSelection(true)
    this.addToSelection(elems, showGrips)
  }

  /**
  * Removes elements from the selection.
  * @function module:svgcanvas.SvgCanvas#removeFromSelection
  * @param {Element[]} elemsToRemove - An array of elements to remove from selection
  * @returns {void}
  */
  removeFromSelection (elemsToRemove) {
    if (isNullish(this.selectedElements[0])) { return }
    if (!elemsToRemove.length) { return }

    // find every element and remove it from our array copy
    const newSelectedItems = []
    const len = this.selectedElements.length
    for (let i = 0; i < len; ++i) {
      const elem = this.selectedElements[i]
      if (elem) {
        // keep the item
        if (!elemsToRemove.includes(elem)) {
          newSelectedItems.push(elem)
        } else { // remove the item and its selector
          this.selectorManager.releaseSelector(elem)
        }
      }
    }
    // the copy becomes the master now
    this.selectedElements = newSelectedItems
  }

  /**
    * Clears the selection, then adds all elements in the current layer to the selection.
    * @function module:svgcanvas.SvgCanvas#selectAllInCurrentLayer
    * @returns {void}
    */
  selectAllInCurrentLayer () {
    const currentLayer = this.getCurrentDrawing().getCurrentLayer()
    if (currentLayer) {
      this.currentMode = 'select'
      if (this.currentGroup) {
        this.selectOnly(this.currentGroup.children)
      } else {
        this.selectOnly(currentLayer.children)
      }
    }
  }

  getOpacity () {
    return this.curShape.opacity
  }

  /**
  * @function module:svgcanvas.SvgCanvas#getSnapToGrid
  * @returns {boolean} The current snap to grid setting
  */
  getSnapToGrid () { return this.curConfig.gridSnapping }
  /**
  * @function module:svgcanvas.SvgCanvas#getVersion
  * @returns {string} A string which describes the revision number of SvgCanvas.
  */
  getVersion () { return 'svgcanvas.js ($Rev$)' }
  /**
  * Update interface strings with given values.
  * @function module:svgcanvas.SvgCanvas#setUiStrings
  * @param {module:path.uiStrings} strs - Object with strings (see the [locales API]{@link module:locale.LocaleStrings} and the [tutorial]{@tutorial LocaleDocs})
  * @returns {void}
  */
  setUiStrings (strs) {
    Object.assign(this.uiStrings, strs.notification)
    pathModule.setUiStrings(strs)
  }

  /**
  * Update configuration options with given values.
  * @function module:svgcanvas.SvgCanvas#setConfig
  * @param {module:SVGEditor.Config} opts - Object with options
  * @returns {void}
  */
  setConfig (opts) { Object.assign(this.curConfig, opts) }
  /**
  * @function module:svgcanvas.SvgCanvas#getDocumentTitle
  * @returns {string|void} The current document title or an empty string if not found
  */
  getDocumentTitle () { return this.getTitle(this.svgContent) }
  getOffset () {
    return { x: Number(this.svgContent.getAttribute('x')), y: Number(this.svgContent.getAttribute('y')) }
  }

  getColor (type) { return this.curProperties[type] }
  setStrokePaint (paint) { this.setPaint('stroke', paint) }
  /**
  * @function module:svgcanvas.SvgCanvas#setFillPaint
  * @param {module:jGraduate~Paint} paint
  * @returns {void}
  */
  setFillPaint (paint) { this.setPaint('fill', paint) }
  /**
  * @function module:svgcanvas.SvgCanvas#getStrokeWidth
  * @returns {Float|string} The current stroke-width value
  */
  getStrokeWidth () { return this.curProperties.stroke_width }
  /**
  * @function module:svgcanvas.SvgCanvas#getStyle
  * @returns {module:svgcanvas.StyleOptions} current style options
  */
  getStyle () { return this.curShape }
  /**
  * Sets the given opacity on the current selected elements.
  * @function module:svgcanvas.SvgCanvas#setOpacity
  * @param {string} val
  * @returns {void}
  */
  setOpacity (val) {
    this.curShape.opacity = val
    this.changeSelectedAttribute('opacity', val)
  }

  /**
  * @function module:svgcanvas.SvgCanvas#getFillOpacity
  * @returns {Float} the current fill opacity
  */
  getFillOpacity () { return this.curShape.fill_opacity }
  /**
  * @function module:svgcanvas.SvgCanvas#getStrokeOpacity
  * @returns {string} the current stroke opacity
  */
  getStrokeOpacity () { return this.curShape.stroke_opacity }
  /**
  * Sets the current fill/stroke opacity.
  * @function module:svgcanvas.SvgCanvas#setPaintOpacity
  * @param {string} type - String with "fill" or "stroke"
  * @param {Float} val - Float with the new opacity value
  * @param {boolean} preventUndo - Indicates whether or not this should be an undoable action
  * @returns {void}
  */
  setPaintOpacity (type, val, preventUndo) {
    this.curShape[type + '_opacity'] = val
    if (!preventUndo) {
      this.changeSelectedAttribute(type + '-opacity', val)
    } else {
      this.changeSelectedAttributeNoUndo(type + '-opacity', val)
    }
  }

  /**
  * Gets the current fill/stroke opacity.
  * @function module:svgcanvas.SvgCanvas#getPaintOpacity
  * @param {"fill"|"stroke"} type - String with "fill" or "stroke"
  * @returns {Float} Fill/stroke opacity
  */
  getPaintOpacity (type) {
    return type === 'fill' ? this.getFillOpacity() : this.getStrokeOpacity()
  }

  /**
  * Gets the `stdDeviation` blur value of the given element.
  * @function module:svgcanvas.SvgCanvas#getBlur
  * @param {Element} elem - The element to check the blur value for
  * @returns {string} stdDeviation blur attribute value
  */
  getBlur (elem) {
    let val = 0
    if (elem) {
      const filterUrl = elem.getAttribute('filter')
      if (filterUrl) {
        const blur = getElement(elem.id + '_blur')
        if (blur) {
          val = blur.firstChild.getAttribute('stdDeviation')
        } else {
          const filterElem = getRefElem(filterUrl)
          const blurElem = getFeGaussianBlur(filterElem)
          if (blurElem !== null) {
            val = blurElem.getAttribute('stdDeviation')
          }
        }
      }
    }
    return val
  }

  /**
  * Sets a given URL to be a "last good image" URL.
  * @function module:svgcanvas.SvgCanvas#setGoodImage
  * @param {string} val
  * @returns {void}
  */
  setGoodImage (val) { this.lastGoodImgUrl = val }
  /**
  * Returns the current drawing as raw SVG XML text.
  * @function module:svgcanvas.SvgCanvas#getSvgString
  * @returns {string} The current drawing as raw SVG XML text.
  */
  getSvgString () {
    this.saveOptions.apply = false
    return this.svgCanvasToString()
  }

  /**
  * This function determines whether to use a nonce in the prefix, when
  * generating IDs for future documents in SVG-Edit.
  * If you're controlling SVG-Edit externally, and want randomized IDs, call
  * this BEFORE calling `svgCanvas.setSvgString`.
  * @function module:svgcanvas.SvgCanvas#randomizeIds
  * @param {boolean} [enableRandomization] If true, adds a nonce to the prefix. Thus
  * `svgCanvas.randomizeIds() <==> svgCanvas.randomizeIds(true)`
  * @returns {void}
  */
  randomizeIds (enableRandomization) {
    if (arguments.length > 0 && enableRandomization === false) {
      draw.randomizeIds(false, this.getCurrentDrawing())
    } else {
      draw.randomizeIds(true, this.getCurrentDrawing())
    }
  }

  /**
  * Convert selected element to a path, or get the BBox of an element-as-path.
  * @function module:svgcanvas.SvgCanvas#convertToPath
  * @todo (codedread): Remove the getBBox argument and split this function into two.
  * @param {Element} elem - The DOM element to be converted
  * @param {boolean} getBBox - Boolean on whether or not to only return the path's BBox
  * @returns {void|DOMRect|false|SVGPathElement|null} If the getBBox flag is true, the resulting path's bounding box object.
  * Otherwise the resulting path element is returned.
  */
  convertToPath (elem, getBBox) {
    // if elems not given, recursively call convertPath for all selected elements.
    if (!elem) {
      const elems = this.selectedElements
      elems.forEach((el) => {
        if (el) { this.convertToPath(el) }
      })
      return undefined
    }
    if (getBBox) {
      return getBBoxOfElementAsPath(elem, this.addSVGElementsFromJson, this.pathActions)
    }
    // TODO: Why is this applying attributes from this.curShape, then inside utilities.convertToPath it's pulling addition attributes from elem?
    // TODO: If convertToPath is called with one elem, this.curShape and elem are probably the same; but calling with multiple is a bug or cool feature.
    const attrs = {
      fill: this.curShape.fill,
      'fill-opacity': this.curShape.fill_opacity,
      stroke: this.curShape.stroke,
      'stroke-width': this.curShape.stroke_width,
      'stroke-dasharray': this.curShape.stroke_dasharray,
      'stroke-linejoin': this.curShape.stroke_linejoin,
      'stroke-linecap': this.curShape.stroke_linecap,
      'stroke-opacity': this.curShape.stroke_opacity,
      opacity: this.curShape.opacity,
      visibility: 'hidden'
    }
    return convertToPath(elem, attrs, this) // call convertToPath from utilities.js
  }

  /**
  * Removes all selected elements from the DOM and adds the change to the
  * history stack. Remembers removed elements on the clipboard.
  * @function module:svgcanvas.SvgCanvas#cutSelectedElements
  * @returns {void}
  */
  cutSelectedElements () {
    this.copySelectedElements()
    this.deleteSelectedElements()
  }

  initializeSvgCanvasMethods () {
    this.getJsonFromSvgElements = getJsonFromSvgElements
    this.addSVGElementsFromJson = addSVGElementsFromJson
    this.clearSvgContentElement = clearSvgContentElementInit
    this.textActions = textActionsMethod
    this.getIntersectionList = getIntersectionListMethod
    this.getStrokedBBox = getStrokedBBoxDefaultVisible
    this.getVisibleElements = getVisibleElements
    this.uniquifyElems = uniquifyElemsMethod
    this.setUseData = setUseDataMethod
    this.convertGradients = convertGradientsMethod
    this.setSvgString = setSvgString
    this.importSvgString = importSvgString
    this.runExtensions = runExtensionsMethod
    this.clearSelection = clearSelectionMethod
    this.addToSelection = addToSelectionMethod
    this.stringToHTML = stringToHTML
    this.insertChildAtIndex = insertChildAtIndex
    this.getClosest = getClosest
    this.getParents = getParents
    this.isLayer = draw.Layer.isLayer
    this.matrixMultiply = matrixMultiply
    this.hasMatrixTransform = hasMatrixTransform
    this.transformListToTransform = transformListToTransform
    this.convertToNum = convertToNum
    this.findDefs = findDefs
    this.getUrlFromAttr = getUrlFromAttr
    this.getHref = getHref
    this.setHref = setHref
    this.getBBox = utilsGetBBox
    this.getRotationAngle = getRotationAngle
    this.getElement = getElement
    this.getRefElem = getRefElem
    this.assignAttributes = assignAttributes
    this.cleanupElement = cleanupElement
    this.remapElement = remapElement
    this.recalculateDimensions = recalculateDimensions
    this.sanitizeSvg = sanitizeSvg
    this.groupSvgElem = groupSvgElem // Wrap an SVG element into a group element, mark the group as 'gsvg'.
    this.prepareSvg = prepareSvg // Runs the SVG Document through the sanitizer and then updates its paths.
    this.setRotationAngle = setRotationAngle // Removes any old rotations if present, prepends a new rotation at the transformed center.
    this.recalculateAllSelectedDimensions = recalculateAllSelectedDimensions // Runs `recalculateDimensions` on selected elements,adding changes to a single batch command.
    this.copySelectedElements = copySelectedElements
    this.pasteElements = pasteElementsMethod // Remembers the current selected elements on the clipboard.
    this.groupSelectedElements = groupSelectedElements // Wraps all the selected elements in a group (`g`) element.
    this.pushGroupProperties = pushGroupProperty // Pushes all appropriate parent group properties down to its children
    this.ungroupSelectedElement = ungroupSelectedElement // Unwraps all the elements in a selected group (`g`) element
    this.moveToTopSelectedElement = moveToTopSelectedElem // Repositions the selected element to the bottom in the DOM to appear on top
    this.moveToBottomSelectedElement = moveToBottomSelectedElem // Repositions the selected element to the top in the DOM to appear under other elements
    this.moveUpDownSelected = moveUpDownSelected // Moves the select element up or down the stack, based on the visibly
    this.moveSelectedElements = moveSelectedElements // Moves selected elements on the X/Y axis.
    this.cloneSelectedElements = cloneSelectedElements // Create deep DOM copies (clones) of all selected elements and move them slightly
    this.alignSelectedElements = alignSelectedElements // Aligns selected elements.
    this.updateCanvas = updateCanvas // Updates the editor canvas width/height/position after a zoom has occurred.
    this.cycleElement = cycleElement // Select the next/previous element within the current layer.
    this.getMouseTarget = getMouseTargetMethod
    this.removeUnusedDefElems = removeUnusedDefElemsMethod // remove DOM elements inside the `<defs>` if they are notreferred to,
    this.svgCanvasToString = svgCanvasToString // Main function to set up the SVG content for output.
    this.svgToString = svgToString // Sub function ran on each SVG element to convert it to a string as desired.
    this.embedImage = embedImage // Converts a given image file to a data URL when possibl
    this.rasterExport = rasterExport // Generates a PNG (or JPG, BMP, WEBP) Data URL based on the current image
    this.exportPDF = exportPDF // Generates a PDF based on the current image, then calls "exportedPDF"
    this.identifyLayers = draw.identifyLayers
    this.createLayer = draw.createLayer
    this.cloneLayer = draw.cloneLayer
    this.deleteCurrentLayer = draw.deleteCurrentLayer
    this.setCurrentLayer = draw.setCurrentLayer
    this.renameCurrentLayer = draw.renameCurrentLayer
    this.setCurrentLayerPosition = draw.setCurrentLayerPosition
    this.setLayerVisibility = draw.setLayerVisibility
    this.moveSelectedToLayer = draw.moveSelectedToLayer
    this.mergeLayer = draw.mergeLayer
    this.mergeAllLayers = draw.mergeAllLayers
    this.leaveContext = draw.leaveContext
    this.setContext = draw.setContext
    this.getBold = elemGetSet.getBoldMethod // Check whether selected element is bold or not.
    this.setBold = elemGetSet.setBoldMethod // Make the selected element bold or normal.
    this.getItalic = elemGetSet.getItalicMethod // Check whether selected element is in italics or not.
    this.setItalic = elemGetSet.setItalicMethod // Make the selected element italic or normal.
    this.setTextAnchor = elemGetSet.setTextAnchorMethod // Set the new text anchor.
    this.getFontFamily = elemGetSet.getFontFamilyMethod // The current font family
    this.setFontFamily = elemGetSet.setFontFamilyMethod // Set the new font family.
    this.setFontColor = elemGetSet.setFontColorMethod // Set the new font color.
    this.getFontColor = elemGetSet.getFontColorMethod // The current font color
    this.getFontSize = elemGetSet.getFontSizeMethod // The current font size
    this.setFontSize = elemGetSet.setFontSizeMethod // Applies the given font size to the selected element.
    this.getText = elemGetSet.getTextMethod // current text (`textContent`) of the selected element
    this.setTextContent = elemGetSet.setTextContentMethod // Updates the text element with the given string.
    this.setImageURL = elemGetSet.setImageURLMethod // Sets the new image URL for the selected image element
    this.setLinkURL = elemGetSet.setLinkURLMethod // Sets the new link URL for the selected anchor element.
    this.setRectRadius = elemGetSet.setRectRadiusMethod // Sets the `rx` and `ry` values to the selected `rect` element
    this.makeHyperlink = elemGetSet.makeHyperlinkMethod // Wraps the selected element(s) in an anchor element or converts group to one.
    this.removeHyperlink = elemGetSet.removeHyperlinkMethod
    this.setSegType = elemGetSet.setSegTypeMethod // Sets the new segment type to the selected segment(s).
    this.setStrokeWidth = elemGetSet.setStrokeWidthMethod // Sets the stroke width for the current selected elements.
    this.getResolution = elemGetSet.getResolutionMethod // The current dimensions and zoom level in an object
    this.getTitle = elemGetSet.getTitleMethod // the current group/SVG's title contents or `undefined` if no element
    this.setGroupTitle = elemGetSet.setGroupTitleMethod // Sets the group/SVG's title content.
    this.setStrokeAttr = elemGetSet.setStrokeAttrMethod // Set the given stroke-related attribute the given value for selected elements.
    this.setBackground = elemGetSet.setBackgroundMethod // Set the background of the editor (NOT the actual document).
    this.setDocumentTitle = elemGetSet.setDocumentTitleMethod // Adds/updates a title element for the document with the given name.
    this.getEditorNS = elemGetSet.getEditorNSMethod // Returns the editor's namespace URL, optionally adding it to the root element.
    this.setResolution = elemGetSet.setResolutionMethod // Changes the document's dimensions to the given size.
    this.setBBoxZoom = elemGetSet.setBBoxZoomMethod // Sets the zoom level on the canvas-side based on the given value.
    this.setCurrentZoom = elemGetSet.setZoomMethod // Sets the zoom to the given level.
    this.setColor = elemGetSet.setColorMethod // Change the current stroke/fill color/gradien
    this.setGradient = elemGetSet.setGradientMethod // Apply the current gradient to selected element's fill or stroke.
    this.setPaint = elemGetSet.setPaintMethod // Set a color/gradient to a fill/stroke.
    this.changeSelectedAttributeNoUndo = changeSelectedAttributeNoUndoMethod // This function makes the changes to the elements. It does not add the change to the history stack.
    this.changeSelectedAttribute = changeSelectedAttributeMethod // Change the given/selected element and add the original value to the history stack.
    this.deleteSelectedElements = deleteSelectedElements // Removes all selected elements from the DOM and adds the change to the history
    this.setBlurNoUndo = setBlurNoUndo // Sets the `stdDeviation` blur value on the selected element without being undoable.
    this.setBlurOffsets = setBlurOffsets // Sets the `x`, `y`, `width`, `height` values of the filter element in order to make the blur not be clipped. Removes them if not neeeded.
    this.setBlur = setBlur // Adds/updates the blur filter to the selected element.
    this.smoothControlPoints = pathModule.smoothControlPoints
    this.getTypeMap = getTypeMap
    this.history = history // object with all histor methods
    this.NS = NS
    this.$id = $id
    this.$qq = $qq
    this.$qa = $qa
  }
} // End class

// attach utilities function to the class that are used by SvgEdit so
// we can avoid using the whole utilities.js file in svgEdit.js
SvgCanvas.$id = $id
SvgCanvas.$qq = $qq
SvgCanvas.$qa = $qa
SvgCanvas.isNullish = isNullish
SvgCanvas.encode64 = encode64
SvgCanvas.decode64 = decode64
SvgCanvas.mergeDeep = mergeDeep
SvgCanvas.getClosest = getClosest
SvgCanvas.getParents = getParents
SvgCanvas.blankPageObjectURL = blankPageObjectURL

export default SvgCanvas
