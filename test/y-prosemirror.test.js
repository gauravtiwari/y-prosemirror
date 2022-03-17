
import * as t from 'lib0/testing'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import * as Y from 'yjs'
// @ts-ignore
import { applyRandomTests } from 'yjs/testHelper'

import { ySyncPlugin, prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '../src/y-prosemirror.js'
import { prosemirrorToYDoc } from '../src/lib.js'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import * as basicSchema from 'prosemirror-schema-basic'
import { findWrapping } from 'prosemirror-transform'
import { DOMParser } from 'prosemirror-model'
import { schema as complexSchema } from './complexSchema.js'

const schema = /** @type {any} */ (basicSchema.schema)

/**
 * @param {t.TestCase} tc
 */
export const testDocTransformation = tc => {
  const view = createNewProsemirrorView(new Y.Doc())
  view.dispatch(view.state.tr.insert(0, /** @type {any} */ (schema.node('paragraph', undefined, schema.text('hello world')))))
  const stateJSON = view.state.doc.toJSON()
  // test if transforming back and forth from Yjs doc works
  const backandforth = yDocToProsemirrorJSON(prosemirrorJSONToYDoc(/** @type {any} */ (schema), stateJSON))
  t.compare(stateJSON, backandforth)
}

/**
 * @param {t.TestCase} tc
 */
export const testprosemirrorToYDoc = tc => {
  const node = document.createElement('p')
  node.textContent = 'Yjs is awesome'
  const doc = DOMParser.fromSchema(basicSchema.schema).parse(node)

  const ydocWithRandomClientID = prosemirrorToYDoc(doc)
  t.assert(ydocWithRandomClientID.clientID !== null, 'ClientID must not be null')

  const existingClientID = 10
  const ydocWithGlobalClientID = prosemirrorToYDoc(doc, existingClientID)
  t.assert(ydocWithGlobalClientID.clientID === 10, 'ClientID must be same as existing')
  const client = ydocWithGlobalClientID.store.clients.get(existingClientID)
  t.assert(client !== null, 'ClientID must be in the clients Map')
}

/**
 * @param {t.TestCase} tc
 */
export const testEmptyNotSync = tc => {
  const ydoc = new Y.Doc()
  const type = ydoc.getXmlFragment('prosemirror')
  const view = createNewComplexProsemirrorView(ydoc)
  t.assert(type.toString() === '', 'should only sync after first change')

  view.dispatch(
    view.state.tr.setNodeMarkup(0, undefined, {
      checked: true
    })
  )
  t.compareStrings(type.toString(), '<custom checked="true"></custom><paragraph></paragraph>')
}

const createNewComplexProsemirrorView = y => {
  const view = new EditorView(null, {
    // @ts-ignore
    state: EditorState.create({
      schema: complexSchema,
      plugins: [ySyncPlugin(y.get('prosemirror', Y.XmlFragment))]
    })
  })
  return view
}

const createNewProsemirrorView = y => {
  const view = new EditorView(null, {
    // @ts-ignore
    state: EditorState.create({
      schema,
      plugins: [ySyncPlugin(y.get('prosemirror', Y.XmlFragment))]
    })
  })
  return view
}

let charCounter = 0

const marksChoices = [
  [schema.mark('strong')],
  [schema.mark('em')],
  [schema.mark('em'), schema.mark('strong')],
  [],
  []
]

const pmChanges = [
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // insert text
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const marks = prng.oneOf(gen, marksChoices)
    const tr = p.state.tr
    const text = charCounter++ + prng.word(gen)
    p.dispatch(tr.insert(insertPos, schema.text(text, marks)))
  },
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // delete text
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const overwrite = math.min(prng.int32(gen, 0, p.state.doc.content.size - insertPos), 2)
    p.dispatch(p.state.tr.insertText('', insertPos, insertPos + overwrite))
  },
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // replace text
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const overwrite = math.min(prng.int32(gen, 0, p.state.doc.content.size - insertPos), 2)
    const text = charCounter++ + prng.word(gen)
    p.dispatch(p.state.tr.insertText(text, insertPos, insertPos + overwrite))
  },
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // insert paragraph
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const marks = prng.oneOf(gen, marksChoices)
    const tr = p.state.tr
    const text = charCounter++ + prng.word(gen)
    p.dispatch(tr.insert(insertPos, schema.node('paragraph', undefined, schema.text(text, marks))))
  },
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // insert codeblock
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const tr = p.state.tr
    const text = charCounter++ + prng.word(gen)
    p.dispatch(tr.insert(insertPos, schema.node('code_block', undefined, schema.text(text))))
  },
  /**
   * @param {Y.Doc} y
   * @param {prng.PRNG} gen
   * @param {EditorView} p
   */
  (y, gen, p) => { // wrap in blockquote
    const insertPos = prng.int32(gen, 0, p.state.doc.content.size)
    const overwrite = prng.int32(gen, 0, p.state.doc.content.size - insertPos)
    const tr = p.state.tr
    tr.setSelection(TextSelection.create(tr.doc, insertPos, insertPos + overwrite))
    const $from = tr.selection.$from
    const $to = tr.selection.$to
    const range = $from.blockRange($to)
    const wrapping = range && findWrapping(range, schema.nodes.blockquote)
    if (wrapping) {
      p.dispatch(tr.wrap(range, wrapping))
    }
  }
]

/**
 * @param {any} result
 */
const checkResult = result => {
  for (let i = 1; i < result.testObjects.length; i++) {
    const p1 = result.testObjects[i - 1].state.doc.toJSON()
    const p2 = result.testObjects[i].state.doc.toJSON()
    t.compare(p1, p2)
  }
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges2 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 2, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges3 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 3, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges30 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 30, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges40 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 40, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges70 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 70, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges100 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 100, createNewProsemirrorView))
}

/**
 * @param {t.TestCase} tc
 */
export const testRepeatGenerateProsemirrorChanges300 = tc => {
  checkResult(applyRandomTests(tc, pmChanges, 300, createNewProsemirrorView))
}
