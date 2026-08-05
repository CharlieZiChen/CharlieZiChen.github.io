(() => {
  'use strict'

  const root = document.getElementById('md-workbench')
  if (!root) return

  const core = globalThis.MarkdownEditorCore
  const adapter = globalThis.ButterflyEditorAdapter
  const componentPreview = globalThis.ButterflyComponentPreview
  const mediaStore = globalThis.MarkdownMediaStore
  const ToastEditor = globalThis.toastui?.Editor
  if (!core || !adapter || !componentPreview || !mediaStore || !ToastEditor) {
    console.error('Markdown 工作台依赖未加载。')
    return
  }

  const {
    BUTTERFLY_COMPONENTS,
    buildAssetPaths,
    candidateRepositoryPathsForPublicAsset,
    contentHash,
    createPublishJob,
    decodeBase64,
    deriveWorkflowState,
    deriveTitle,
    encodeBase64,
    extractWorkflowLogError,
    findAssetIds,
    findReferencedSitePaths,
    isPublishLocked,
    mergeRemoteDocuments,
    migrateDocument,
    normalizeContent,
    normalizeMarkdownStructure,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    replaceAssetReferences,
    repairMarkdownStructure,
    slugify,
    splitFrontMatter,
    stripManagedDocumentChrome,
    validateMarkdownStructure
  } = core

  const STORAGE_KEY = root.dataset.storageKey || 'charliezc.md-pages.v1'
  const REPOSITORY_KEY = `${STORAGE_KEY}.repository`
  const SESSION_TOKEN_KEY = `${STORAGE_KEY}.github-token`
  const PUBLISH_JOB_KEY = `${STORAGE_KEY}.publish-job`
  const CHANNEL_KEY = `${STORAGE_KEY}.channel`
  const GITHUB_API_VERSION = '2022-11-28'
  const MAX_FILE_BYTES = 2 * 1024 * 1024
  const PUBLISH_TIMEOUT_MS = 10 * 60 * 1000
  const BASE_DOCUMENT_TITLE = document.title
  const elements = {
    actionsLink: document.getElementById('mdw-actions-link'),
    assetEmpty: document.getElementById('mdw-asset-empty'),
    assetInput: document.getElementById('mdw-asset-input'),
    assetList: document.getElementById('mdw-asset-list'),
    branch: document.getElementById('mdw-branch'),
    componentDelete: document.getElementById('mdw-component-delete'),
    componentDialog: document.getElementById('mdw-component-dialog'),
    componentDialogEyebrow: document.getElementById('mdw-component-dialog-eyebrow'),
    componentDialogTitle: document.getElementById('mdw-component-dialog-title'),
    componentError: document.getElementById('mdw-component-error'),
    componentFields: document.getElementById('mdw-component-fields'),
    componentPreview: document.getElementById('mdw-component-preview'),
    componentSave: document.getElementById('mdw-component-save'),
    componentSource: document.getElementById('mdw-component-source'),
    componentSourceLabel: document.getElementById('mdw-component-source-label'),
    componentTools: document.getElementById('mdw-component-tools'),
    conflict: document.getElementById('mdw-conflict'),
    conflictDownload: document.getElementById('mdw-conflict-download'),
    conflictLocal: document.getElementById('mdw-conflict-local'),
    conflictRemote: document.getElementById('mdw-conflict-remote'),
    connectButton: document.getElementById('mdw-connect-button'),
    connectionStatus: document.getElementById('mdw-connection-status'),
    deployment: document.getElementById('mdw-deployment'),
    deploymentError: document.getElementById('mdw-deployment-error'),
    deploymentMessage: document.getElementById('mdw-deployment-message'),
    deploymentRecheck: document.getElementById('mdw-deployment-recheck'),
    deploymentTitle: document.getElementById('mdw-deployment-title'),
    deploymentUnlock: document.getElementById('mdw-deployment-unlock'),
    disconnectButton: document.getElementById('mdw-disconnect-button'),
    documentCount: document.getElementById('mdw-document-count'),
    documentList: document.getElementById('mdw-document-list'),
    documentMeta: document.getElementById('mdw-document-meta'),
    documentTitle: document.getElementById('mdw-document-title'),
    dialogHelp: document.getElementById('mdw-dialog-help'),
    downloadButton: document.getElementById('mdw-download-button'),
    emptyState: document.getElementById('mdw-empty-state'),
    fileInput: document.getElementById('mdw-file-input'),
    frontMatter: document.getElementById('mdw-front-matter'),
    libraryEmpty: document.getElementById('mdw-library-empty'),
    liveLink: document.getElementById('mdw-live-link'),
    markdownTab: document.getElementById('mdw-markdown-tab'),
    owner: document.getElementById('mdw-owner'),
    progressBar: document.getElementById('mdw-progress-bar'),
    publishButton: document.getElementById('mdw-publish-button'),
    repo: document.getElementById('mdw-repo'),
    richEditor: document.getElementById('mdw-rich-editor'),
    saveButton: document.getElementById('mdw-save-button'),
    saveState: document.getElementById('mdw-save-state'),
    status: document.getElementById('mdw-status'),
    syncButton: document.getElementById('mdw-sync-button'),
    token: document.getElementById('mdw-token'),
    workspace: document.getElementById('mdw-workspace'),
    wysiwygTab: document.getElementById('mdw-wysiwyg-tab')
  }

  const defaultRepository = {
    owner: root.dataset.defaultOwner || '',
    repo: root.dataset.defaultRepo || '',
    branch: root.dataset.defaultBranch || 'main',
    basePath: root.dataset.basePath || 'source/pages'
  }
  const ASSET_BASE_PATH = root.dataset.assetBasePath || 'source/uploads'
  const state = {
    activeId: null,
    connected: false,
    documents: [],
    mode: 'wysiwyg',
    publishJob: null,
    repository: null
  }
  let editor = null
  let componentEntries = []
  let activeComponentId = ''
  let activeComponentValues = null
  let pendingSourceComponentId = ''
  let pendingVisualComponentId = ''
  let githubToken = ''
  let saveTimer = 0
  let statusTimer = 0
  let deploymentRun = 0
  let actionsReadable = null
  let publishPreparing = false
  let suppressEditorChange = false
  let editorLoadSequence = 0
  let pendingAssetFieldPath = null
  const assetObjectUrls = new Map()
  const previewUrlToReference = new Map()
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel(CHANNEL_KEY) : null

  const createId = fileName => {
    const randomPart = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
    return `${slugify(String(fileName).replace(/\.md$/i, ''))}-${Date.now().toString(36)}-${randomPart}`
  }

  const formatDate = timestamp => new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp || Date.now()))

  const announce = (message, type = 'success') => {
    clearTimeout(statusTimer)
    elements.status.textContent = message
    elements.status.className = `mdw-status${type === 'error' ? ' mdw-status-error' : ''}`
    elements.status.hidden = false
    statusTimer = setTimeout(() => { elements.status.hidden = true }, 6000)
  }

  const loadJson = (storage, key, fallback) => {
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      return value ?? fallback
    } catch {
      return fallback
    }
  }

  const loadDocuments = () => {
    const stored = loadJson(localStorage, STORAGE_KEY, [])
    if (!Array.isArray(stored)) return []
    return stored
      .filter(document => document && typeof document.id === 'string' && typeof document.content === 'string')
      .map(document => migrateDocument({
        ...document,
        createdAt: Number(document.createdAt) || Date.now(),
        fileName: String(document.fileName || '未命名文稿.md'),
        title: String(document.title || deriveTitle(document.content, document.fileName)),
        updatedAt: Number(document.updatedAt) || Date.now()
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  const persistDocuments = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.documents))
  }

  const persistPublishJob = (broadcast = true) => {
    if (state.publishJob) localStorage.setItem(PUBLISH_JOB_KEY, JSON.stringify(state.publishJob))
    else localStorage.removeItem(PUBLISH_JOB_KEY)
    if (broadcast) channel?.postMessage({ type: 'publish-job', job: state.publishJob })
  }

  const loadRepositorySettings = () => {
    const stored = loadJson(localStorage, REPOSITORY_KEY, {})
    if (stored.owner === 'CharlieZiChen' && stored.repo === 'CharlieZiChen.github.io') stored.repo = defaultRepository.repo
    return { ...defaultRepository, ...stored, basePath: defaultRepository.basePath }
  }

  const getActiveDocument = () => state.documents.find(document => document.id === state.activeId) || null
  const encodePath = value => String(value).split('/').map(encodeURIComponent).join('/')
  const repositoryEndpoint = repository => `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`

  const updatePageUrl = (id, method = 'pushState') => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('doc', id)
    else url.searchParams.delete('doc')
    history[method]({}, '', url)
  }

  const validateRepository = repository => {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(repository.owner)) throw new Error('GitHub 所有者名称格式不正确。')
    if (!/^[A-Za-z0-9._-]+$/.test(repository.repo)) throw new Error('GitHub 仓库名称格式不正确。')
    if (!repository.branch || /\s|[\u0000-\u001f\u007f~^:?*[\\]/.test(repository.branch)) throw new Error('Git 分支名称格式不正确。')
    return repository
  }

  const repositoryFromFields = () => validateRepository({
    owner: elements.owner.value.trim(),
    repo: elements.repo.value.trim(),
    branch: elements.branch.value.trim() || 'main',
    basePath: defaultRepository.basePath
  })

  const githubRequest = async (endpoint, options = {}) => {
    if (!githubToken) throw new Error('请先连接 GitHub。')
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        Accept: options.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    })
    if (options.allow404 && response.status === 404) return null
    if (!response.ok) {
      let detail = ''
      try { detail = (await response.json()).message || '' } catch { detail = await response.text() }
      const error = new Error(detail || `GitHub API 请求失败（${response.status}）。`)
      error.status = response.status
      throw error
    }
    if (response.status === 204) return null
    return options.raw ? normalizeContent(await response.text()) : response.json()
  }

  const setConnectionStatus = (message, type = 'idle') => {
    elements.connectionStatus.textContent = message
    elements.connectionStatus.dataset.state = type
  }

  const resolvePreviewAsset = value => {
    const source = String(value || '')
    const stagedId = source.match(/^mdw-asset:\/\/([a-z0-9-]+)$/i)?.[1]?.toLowerCase()
    return stagedId ? (assetObjectUrls.get(stagedId) || '') : source
  }

  const renderComponentPreviewNode = (entry, values = entry?.values) => entry
    ? componentPreview.render(entry.name, values || adapter.valuesFromEntry(entry), { document, resolveAsset: resolvePreviewAsset })
    : null

  const createWidget = text => {
    const id = text.match(/BUTTERFLY_COMPONENT_([a-z0-9-]+)/i)?.[1] || ''
    const entry = componentEntries.find(item => item.id === id)
    const card = document.createElement('span')
    const isMarkdownStructure = entry?.kind === 'markdown-structure'
    card.className = `mdw-butterfly-widget${isMarkdownStructure ? ' mdw-structure-widget' : ''}`
    card.dataset.componentId = id
    card.contentEditable = 'false'
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', `编辑 ${entry?.label || 'Butterfly'}${isMarkdownStructure ? '' : '组件'}`)
    const badge = document.createElement('span')
    badge.className = 'mdw-butterfly-widget-badge'
    badge.textContent = isMarkdownStructure ? 'Markdown 结构' : 'Butterfly'
    const title = document.createElement('strong')
    title.textContent = entry?.label || '主题组件'
    const summary = document.createElement('span')
    summary.className = 'mdw-butterfly-widget-summary'
    summary.textContent = entry ? adapter.summarizeEntry(entry) : '组件数据将在保存时保留'
    const action = document.createElement('span')
    action.className = 'mdw-butterfly-widget-action'
    action.textContent = '编辑'
    card.append(badge, title, summary, action)
    const visual = document.createElement('span')
    visual.className = 'mdw-butterfly-widget-preview'
    const rendered = renderComponentPreviewNode(entry)
    if (rendered) visual.append(rendered)
    card.append(visual)
    return card
  }

  const markUnsaved = () => {
    if (suppressEditorChange || !getActiveDocument()) return
    elements.saveState.textContent = '正在修改…'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveActiveDocument({ silent: true }), 700)
  }

  const getValueAtPath = (target, path) => path.reduce((value, key) => value?.[key], target)
  const setValueAtPath = (target, path, value) => {
    let current = target
    path.slice(0, -1).forEach(key => { current = current[key] })
    current[path[path.length - 1]] = value
  }

  const assetReference = id => `mdw-asset://${id}`

  const objectUrlForAsset = record => {
    if (assetObjectUrls.has(record.id)) return assetObjectUrls.get(record.id)
    const url = URL.createObjectURL(record.blob)
    assetObjectUrls.set(record.id, url)
    previewUrlToReference.set(url, assetReference(record.id))
    return url
  }

  const dehydrateAssetReferences = source => {
    let result = normalizeContent(source)
    previewUrlToReference.forEach((reference, url) => { result = result.split(url).join(reference) })
    return result
  }

  const hydrateAssetReferences = async source => {
    const content = normalizeContent(source)
    const replacements = {}
    await Promise.all(findAssetIds(content).map(async id => {
      const record = await mediaStore.get(id)
      if (record?.blob) replacements[id] = objectUrlForAsset(record)
    }))
    return replaceAssetReferences(content, replacements)
  }

  const stageAsset = async file => {
    const activeDocument = getActiveDocument()
    if (!activeDocument) throw new Error('请先选择一份文稿。')
    const record = await mediaStore.add(file, activeDocument.id)
    objectUrlForAsset(record)
    await renderMediaLibrary()
    return record
  }

  const insertAssetRecord = record => {
    if (!editor || !record) return
    const url = objectUrlForAsset(record)
    const label = String(record.originalName || record.name).replace(/[\]\\]/g, '')
    const markdown = record.isImage ? `![${label}](${url})` : `[下载 ${label}](${url})`
    editor.insertText(`${state.mode === 'markdown' ? '' : '\n'}${markdown}${state.mode === 'markdown' ? '' : '\n'}`)
    editor.focus()
    markUnsaved()
  }

  const removeAssetRecord = async record => {
    const activeDocument = saveActiveDocument({ silent: true, noRender: true })
    if (activeDocument?.content.includes(assetReference(record.id)) && !window.confirm('该资源仍被当前草稿引用。移除后发布会被阻止，确定继续吗？')) return
    await mediaStore.remove(record.id)
    const url = assetObjectUrls.get(record.id)
    if (url) {
      URL.revokeObjectURL(url)
      assetObjectUrls.delete(record.id)
      previewUrlToReference.delete(url)
    }
    await renderMediaLibrary()
    announce('已移除本地待发布资源。')
  }

  const renderMediaLibrary = async () => {
    const activeDocument = getActiveDocument()
    const requestedId = activeDocument?.id || ''
    const records = requestedId ? await mediaStore.list(requestedId) : []
    if (getActiveDocument()?.id !== requestedId) return
    elements.assetList.replaceChildren()
    elements.assetEmpty.hidden = records.length > 0
    records.forEach(record => {
      const item = document.createElement('div')
      item.className = 'mdw-asset-item'
      let visual
      if (record.isImage) {
        visual = document.createElement('img')
        visual.className = 'mdw-asset-preview'
        visual.src = objectUrlForAsset(record)
        visual.alt = ''
      } else {
        visual = document.createElement('span')
        visual.className = 'mdw-asset-icon'
        visual.innerHTML = '<i class="fas fa-file" aria-hidden="true"></i>'
      }
      const copy = document.createElement('div')
      copy.className = 'mdw-asset-copy'
      const title = document.createElement('strong')
      title.textContent = record.originalName || record.name
      const meta = document.createElement('span')
      meta.textContent = `${mediaStore.formatBytes(record.size)} · 待随下次发布提交`
      copy.append(title, meta)
      const actions = document.createElement('div')
      actions.className = 'mdw-asset-actions'
      const insert = document.createElement('button')
      insert.type = 'button'
      insert.className = 'mdw-button mdw-button-secondary'
      insert.textContent = '插入'
      insert.addEventListener('click', () => insertAssetRecord(record))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'mdw-button mdw-button-danger'
      remove.textContent = '移除'
      remove.addEventListener('click', () => removeAssetRecord(record).catch(error => announce(error.message, 'error')))
      actions.append(insert, remove)
      item.append(visual, copy, actions)
      elements.assetList.append(item)
    })
  }

  const initializeEditor = () => {
    editor = new ToastEditor({
      el: elements.richEditor,
      height: '640px',
      hideModeSwitch: true,
      initialEditType: 'wysiwyg',
      initialValue: '',
      language: 'zh-CN',
      placeholder: '从这里开始写作…',
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['quote', 'ul', 'ol', 'task'],
        ['table', 'image', 'link'],
        ['code', 'codeblock']
      ],
      usageStatistics: false,
      useCommandShortcut: true,
      widgetRules: [{ rule: new RegExp(adapter.PLACEHOLDER_PATTERN_SOURCE), toDOM: createWidget }],
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          try {
            const record = await stageAsset(blob)
            callback(objectUrlForAsset(record), record.originalName || record.name)
            announce('图片已暂存，将随文稿一起发布。')
          } catch (error) {
            announce(`图片添加失败：${error.message}`, 'error')
          }
        }
      },
      events: { change: markUnsaved }
    })
  }

  const readEditorBody = () => {
    if (!editor) return ''
    const markdown = normalizeContent(editor.getMarkdown())
    return dehydrateAssetReferences(state.mode === 'wysiwyg' ? adapter.restoreMarkdown(markdown, componentEntries) : markdown)
  }

  const composeDocument = () => {
    const body = normalizeMarkdownStructure(readEditorBody()).replace(/^\n+/, '').replace(/\s+$/, '')
    const frontMatter = normalizeContent(elements.frontMatter.value).trim()
    return `${frontMatter ? `---\n${frontMatter}\n---\n\n` : ''}${body}${body ? '\n' : ''}`
  }

  const saveActiveDocument = (options = {}) => {
    const document = getActiveDocument()
    if (!document || !editor) return null
    clearTimeout(saveTimer)
    document.content = composeDocument()
    document.title = deriveTitle(document.content, document.fileName)
    document.updatedAt = Date.now()
    document.dirty = document.remotePath ? (!document.baseContentHash || contentHash(document.content) !== document.baseContentHash) : true
    if (document.syncStatus !== 'conflict') document.syncStatus = document.dirty ? 'local-ahead' : 'clean'
    state.documents.sort((left, right) => right.updatedAt - left.updatedAt)
    try {
      persistDocuments()
      elements.saveState.textContent = '已自动保存'
      if (!options.noRender) render()
      if (!options.silent) announce('草稿已保存到当前浏览器。')
      return document
    } catch (error) {
      console.error('保存 Markdown 草稿失败。', error)
      elements.saveState.textContent = '保存失败'
      announce('保存失败：浏览器本地存储空间可能不足。', 'error')
      return null
    }
  }

  const loadActiveDocumentIntoEditor = async () => {
    const activeDocument = getActiveDocument()
    if (!activeDocument || !editor) return
    const sequence = ++editorLoadSequence
    const editableSource = stripManagedDocumentChrome(activeDocument.content)
    const repaired = repairMarkdownStructure(editableSource)
    if (repaired.repairs) {
      activeDocument.content = repaired.content.trimEnd() + '\n'
      activeDocument.updatedAt = Date.now()
      activeDocument.dirty = true
      activeDocument.syncStatus = 'local-ahead'
      persistDocuments()
      announce(`已安全修复 ${repaired.repairs} 处被拆开的列表代码块，请确认后再发布。`)
    }
    const parsed = splitFrontMatter(repaired.content)
    const hydratedBody = await hydrateAssetReferences(parsed.body)
    if (sequence !== editorLoadSequence || getActiveDocument()?.id !== activeDocument.id) return
    elements.frontMatter.value = parsed.frontMatter
    suppressEditorChange = true
    if (state.mode === 'wysiwyg') {
      const protectedBody = adapter.protectMarkdown(hydratedBody)
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
      editor.changeMode('wysiwyg', true)
    } else {
      componentEntries = []
      editor.setMarkdown(hydratedBody, false)
      editor.changeMode('markdown', true)
    }
    requestAnimationFrame(() => { suppressEditorChange = false })
    elements.saveState.textContent = '已保存'
    renderMediaLibrary().catch(error => console.warn('读取待发布资源失败。', error))
  }

  const switchMode = async mode => {
    if (!editor || mode === state.mode) return
    suppressEditorChange = true
    if (mode === 'markdown') {
      const raw = dehydrateAssetReferences(adapter.restoreMarkdown(editor.getMarkdown(), componentEntries))
      componentEntries = []
      editor.setMarkdown(raw, false)
      editor.changeMode('markdown')
    } else {
      const hydrated = await hydrateAssetReferences(normalizeMarkdownStructure(dehydrateAssetReferences(editor.getMarkdown())))
      const protectedBody = adapter.protectMarkdown(hydrated)
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
      editor.changeMode('wysiwyg')
    }
    state.mode = mode
    renderModeSwitch()
    requestAnimationFrame(() => { suppressEditorChange = false })
  }

  const reloadEditorBody = async body => {
    suppressEditorChange = true
    const hydratedBody = await hydrateAssetReferences(body)
    if (state.mode === 'wysiwyg') {
      const protectedBody = adapter.protectMarkdown(hydratedBody)
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
    } else {
      componentEntries = []
      editor.setMarkdown(hydratedBody, false)
    }
    requestAnimationFrame(() => { suppressEditorChange = false })
  }

  const renderComponentTools = () => {
    elements.componentTools.replaceChildren()
    BUTTERFLY_COMPONENTS.forEach(component => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mdw-tool-button'
      button.dataset.component = component.id
      button.title = component.description
      button.textContent = component.label
      elements.componentTools.append(button)
    })
  }

  const insertButterflyComponent = componentId => {
    const component = BUTTERFLY_COMPONENTS.find(item => item.id === componentId)
    if (!component || !editor) return
    if (state.mode === 'markdown') {
      const entry = adapter.entryFromComponent(component)
      if (!entry) return
      componentEntries.push(entry)
      pendingSourceComponentId = entry.id
      openComponentDialog(entry.id)
    } else {
      const entry = adapter.entryFromComponent(component)
      if (!entry) return
      componentEntries.push(entry)
      pendingVisualComponentId = entry.id
      editor.insertText(`${component.inline ? '' : '\n'}${entry.placeholder}${component.inline ? '' : '\n'}`)
      requestAnimationFrame(() => openComponentDialog(entry.id))
    }
    editor.focus()
    markUnsaved()
  }

  const defaultValueForField = field => {
    if (field.type === 'checkbox') return false
    if (field.type === 'number') return Number(field.min || 0)
    if (field.type === 'color') return '#49b1f5'
    if (field.type === 'repeater') return []
    return ''
  }

  const createRepeaterItem = fields => Object.fromEntries(fields.map(field => [field.key, defaultValueForField(field)]))

  const mermaidTemplates = {
    flowchart: 'graph TD\n  A[开始] --> B[结束]',
    sequence: 'sequenceDiagram\n  participant A as 用户\n  participant B as 系统\n  A->>B: 请求\n  B-->>A: 响应',
    gantt: 'gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段\n  任务 :2026-08-01, 7d'
  }

  const updateComponentSourcePreview = () => {
    const entry = componentEntries.find(item => item.id === activeComponentId)
    if (!entry || !activeComponentValues) return
    const preview = { ...entry, values: JSON.parse(JSON.stringify(activeComponentValues)) }
    adapter.applyValues(preview, preview.values)
    elements.componentSource.textContent = adapter.serializeEntry(preview)
    elements.componentPreview.replaceChildren()
    const rendered = renderComponentPreviewNode(preview, preview.values)
    if (rendered) elements.componentPreview.append(rendered)
  }

  const renderField = (field, values, path, container) => {
    if (field.when && String(activeComponentValues?.[field.when.key] ?? '') !== String(field.when.equals ?? '')) return
    if (activeComponentId) {
      const activeEntry = componentEntries.find(item => item.id === activeComponentId)
      if (activeEntry?.name === 'gallery' && field.key === 'dataUrl' && values.mode !== 'url') return
      if (activeEntry?.name === 'gallery' && field.key === 'items' && values.mode === 'url') return
    }

    if (field.type === 'style-template') {
      const section = document.createElement('section')
      section.className = 'mdw-style-template'
      const heading = document.createElement('div')
      heading.className = 'mdw-style-template-heading'
      const title = document.createElement('strong')
      title.textContent = field.label
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'mdw-button mdw-button-secondary'
      copy.textContent = '复制 CSS 模板'
      const code = document.createElement('pre')
      const className = String(activeComponentValues?.extraClass || 'my-custom-note').replace(/[^A-Za-z0-9_-]/g, '') || 'my-custom-note'
      const template = `/* 自定义提示块：将类名 ${className} 填入“自定义样式类名” */\n.note.${className} {\n  /* 卡片背景 */\n  background: rgba(255, 255, 255, 0.88) !important;\n  /* 左侧强调色 */\n  border-left: 5px solid #49b1f5 !important;\n  /* 圆角与内边距 */\n  border-radius: 12px;\n  padding: 16px;\n  /* 阴影；不需要时可删除 */\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);\n}\n\n[data-theme='dark'] .note.${className} {\n  /* 深色模式背景 */\n  background: rgba(30, 36, 48, 0.88) !important;\n}`
      code.textContent = template
      const help = document.createElement('p')
      help.className = 'mdw-field-help'
      help.textContent = '复制到 source/css/md-components.css 后重新部署；网页不会直接执行任意 CSS。'
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(template)
          copy.textContent = '已复制'
          setTimeout(() => { copy.textContent = '复制 CSS 模板' }, 1600)
        } catch { announce('复制失败，请手动选择模板内容。', 'error') }
      })
      heading.append(title, copy)
      section.append(heading, code, help)
      container.append(section)
      return
    }

    if (field.type === 'repeater') {
      const section = document.createElement('section')
      section.className = 'mdw-repeater'
      const heading = document.createElement('div')
      heading.className = 'mdw-repeater-heading'
      const title = document.createElement('strong')
      title.textContent = field.label
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'mdw-repeater-add'
      add.textContent = `+ ${field.addLabel || '添加一项'}`
      add.addEventListener('click', () => {
        const items = getValueAtPath(activeComponentValues, path) || []
        items.push(createRepeaterItem(field.fields))
        setValueAtPath(activeComponentValues, path, items)
        renderComponentFields()
      })
      heading.append(title, add)
      const itemsContainer = document.createElement('div')
      itemsContainer.className = 'mdw-repeater-items'
      const items = Array.isArray(getValueAtPath(activeComponentValues, path)) ? getValueAtPath(activeComponentValues, path) : []
      items.forEach((item, index) => {
        const card = document.createElement('div')
        card.className = 'mdw-repeater-item'
        const cardHeader = document.createElement('div')
        cardHeader.className = 'mdw-repeater-item-header'
        const count = document.createElement('span')
        count.textContent = `${field.label} ${index + 1}`
        const controls = document.createElement('div')
        controls.className = 'mdw-repeater-controls'
        ;[['↑', -1, '上移'], ['↓', 1, '下移']].forEach(([symbol, offset, label]) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = symbol
          button.title = label
          button.disabled = index + offset < 0 || index + offset >= items.length
          button.addEventListener('click', () => {
            const target = index + offset
            ;[items[index], items[target]] = [items[target], items[index]]
            renderComponentFields()
          })
          controls.append(button)
        })
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = '×'
        remove.title = '删除'
        remove.disabled = items.length <= Number(field.minItems || 0)
        remove.addEventListener('click', () => { items.splice(index, 1); renderComponentFields() })
        controls.append(remove)
        cardHeader.append(count, controls)
        const fields = document.createElement('div')
        fields.className = 'mdw-repeater-item-fields'
        field.fields.forEach(child => renderField(child, item, [...path, index, child.key], fields))
        card.append(cardHeader, fields)
        itemsContainer.append(card)
      })
      section.append(heading, itemsContainer)
      container.append(section)
      return
    }

    const wrapper = document.createElement('div')
    wrapper.className = `mdw-field${['textarea', 'asset'].includes(field.type) ? ' mdw-field-wide' : ''}${field.code ? ' mdw-field-code' : ''}`
    const value = getValueAtPath(activeComponentValues, path)
    if (field.type === 'checkbox') {
      const label = document.createElement('label')
      label.className = 'mdw-checkbox-field'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = Boolean(value)
      input.addEventListener('change', () => { setValueAtPath(activeComponentValues, path, input.checked); updateComponentSourcePreview() })
      label.append(input, document.createTextNode(field.label))
      wrapper.append(label)
      container.append(wrapper)
      return
    }

    const label = document.createElement('label')
    label.className = 'mdw-field-label'
    label.textContent = `${field.label}${field.required ? ' *' : ''}`
    let input
    if (field.type === 'textarea') input = document.createElement('textarea')
    else if (field.type === 'select') {
      input = document.createElement('select')
      field.options.forEach(option => {
        const element = document.createElement('option')
        element.value = option.value
        element.textContent = option.label
        input.append(element)
      })
    } else {
      input = document.createElement('input')
      input.type = field.type === 'number' ? 'number' : (field.type === 'color' ? 'color' : 'text')
    }
    input.value = value ?? ''
    if (field.placeholder) input.placeholder = field.placeholder
    if (field.min !== undefined) input.min = field.min
    if (field.step !== undefined) input.step = field.step
    const updateValue = () => {
      const next = field.type === 'number' ? Number(input.value) : input.value
      setValueAtPath(activeComponentValues, path, next)
      if (field.key === 'template' && mermaidTemplates[next]) activeComponentValues.source = mermaidTemplates[next]
      if (field.key === 'mode' || field.key === 'template' || field.key === 'extraPreset') renderComponentFields()
      else updateComponentSourcePreview()
    }
    input.addEventListener(field.type === 'select' ? 'change' : 'input', updateValue)
    if (field.type === 'asset') {
      const controls = document.createElement('div')
      controls.className = 'mdw-asset-field-control'
      const choose = document.createElement('button')
      choose.type = 'button'
      choose.className = 'mdw-button mdw-button-secondary'
      choose.textContent = '选择文件'
      choose.addEventListener('click', () => {
        pendingAssetFieldPath = path
        elements.assetInput.click()
      })
      controls.append(input, choose)
      label.append(controls)
    } else label.append(input)
    wrapper.append(label)
    if (field.help) {
      const help = document.createElement('p')
      help.className = 'mdw-field-help'
      help.textContent = field.help
      wrapper.append(help)
    }
    container.append(wrapper)
  }

  const renderComponentFields = () => {
    const entry = componentEntries.find(item => item.id === activeComponentId)
    const schema = entry && adapter.getSchema(entry.name)
    if (!entry || !schema || !activeComponentValues) return
    elements.componentFields.replaceChildren()
    const regularFields = schema.fields.filter(field => !field.advanced)
    const advancedFields = schema.fields.filter(field => field.advanced)
    regularFields.forEach(field => renderField(field, activeComponentValues, [field.key], elements.componentFields))
    if (advancedFields.length) {
      const details = document.createElement('details')
      details.className = 'mdw-component-advanced'
      details.open = activeComponentValues.extraPreset === 'custom'
      const summary = document.createElement('summary')
      summary.textContent = '高级样式设置'
      const fields = document.createElement('div')
      fields.className = 'mdw-component-advanced-fields'
      advancedFields.forEach(field => renderField(field, activeComponentValues, [field.key], fields))
      details.append(summary, fields)
      elements.componentFields.append(details)
    }
    elements.componentError.hidden = true
    updateComponentSourcePreview()
  }

  const openComponentDialog = id => {
    const entry = componentEntries.find(item => item.id === id)
    const schema = entry && adapter.getSchema(entry.name)
    if (!entry || !schema) return
    activeComponentId = id
    activeComponentValues = JSON.parse(JSON.stringify(entry.values || adapter.valuesFromEntry(entry)))
    elements.componentDialogTitle.textContent = entry.label
    if (elements.componentDialogEyebrow) elements.componentDialogEyebrow.textContent = entry.kind === 'markdown-structure' ? 'Markdown 结构' : 'Butterfly 组件'
    elements.componentDelete.textContent = entry.kind === 'markdown-structure' ? '删除结构块' : '删除组件'
    elements.componentSave.textContent = entry.kind === 'markdown-structure' ? '保存结构块' : '保存组件'
    if (elements.componentSourceLabel) elements.componentSourceLabel.textContent = entry.kind === 'markdown-structure' ? '查看将要保存的 Markdown' : '查看将要保存的 Butterfly 语法'
    if (elements.dialogHelp) elements.dialogHelp.textContent = entry.kind === 'markdown-structure'
      ? '序号和代码内容分开编辑；保存后会恢复为规范的列表嵌套代码块，避免模式切换破坏结构。'
      : '每个参数独立编辑；保存后仍生成 Butterfly 原生标签。图片和文件可填入外部地址，也可选择本地文件。'
    renderComponentFields()
    elements.componentDialog.showModal()
  }

  const updateActiveComponent = action => {
    const entry = componentEntries.find(item => item.id === activeComponentId)
    if (!entry) return
    if (entry.id === pendingSourceComponentId) {
      if (action === 'save') {
        const errors = adapter.validateValues(entry.name, activeComponentValues)
        if (errors.length) {
          elements.componentError.textContent = errors.join('；')
          elements.componentError.hidden = false
          return
        }
        adapter.applyValues(entry, activeComponentValues)
        editor.insertText(adapter.serializeEntry(entry))
        editor.focus()
        markUnsaved()
      }
      componentEntries = componentEntries.filter(item => item.id !== entry.id)
      pendingSourceComponentId = ''
      elements.componentDialog.close(action)
      return
    }
    if (action === 'delete') {
      const markdown = editor.getMarkdown().split(entry.placeholder).join('')
      componentEntries = componentEntries.filter(item => item.id !== entry.id)
      if (entry.id === pendingVisualComponentId) pendingVisualComponentId = ''
      suppressEditorChange = true
      editor.setMarkdown(markdown, false)
      requestAnimationFrame(() => {
        suppressEditorChange = false
        markUnsaved()
      })
    } else if (action === 'save') {
      const errors = adapter.validateValues(entry.name, activeComponentValues)
      if (errors.length) {
        elements.componentError.textContent = errors.join('；')
        elements.componentError.hidden = false
        return
      }
      adapter.applyValues(entry, activeComponentValues)
      if (entry.id === pendingVisualComponentId) pendingVisualComponentId = ''
      elements.richEditor.querySelectorAll(`[data-component-id="${entry.id}"] .mdw-butterfly-widget-summary`).forEach(summary => {
        summary.textContent = adapter.summarizeEntry(entry)
      })
      elements.richEditor.querySelectorAll(`[data-component-id="${entry.id}"] .mdw-butterfly-widget-preview`).forEach(preview => {
        preview.replaceChildren()
        const rendered = renderComponentPreviewNode(entry)
        if (rendered) preview.append(rendered)
      })
      markUnsaved()
    }
    elements.componentDialog.close(action)
  }

  const renderModeSwitch = () => {
    const isWysiwyg = state.mode === 'wysiwyg'
    elements.wysiwygTab.classList.toggle('is-active', isWysiwyg)
    elements.wysiwygTab.setAttribute('aria-selected', String(isWysiwyg))
    elements.markdownTab.classList.toggle('is-active', !isWysiwyg)
    elements.markdownTab.setAttribute('aria-selected', String(!isWysiwyg))
  }

  const renderDocumentList = () => {
    elements.documentList.replaceChildren()
    elements.documentCount.textContent = String(state.documents.length)
    elements.libraryEmpty.hidden = state.documents.length > 0
    state.documents.forEach(doc => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `mdw-document-item${doc.id === state.activeId ? ' is-active' : ''}`
      button.dataset.documentId = doc.id
      const title = document.createElement('strong')
      title.textContent = doc.title
      const meta = document.createElement('span')
      const stateLabel = doc.syncStatus === 'conflict'
        ? '需要处理冲突'
        : doc.dirty
          ? (doc.remotePath ? '有本地修改' : '本地草稿')
          : '已同步'
      meta.textContent = `${formatDate(doc.updatedAt)} · ${stateLabel}`
      button.append(title, meta)
      button.addEventListener('click', () => selectDocument(doc.id))
      elements.documentList.append(button)
    })
  }

  const renderActiveDocument = () => {
    const document = getActiveDocument()
    elements.emptyState.hidden = Boolean(document)
    elements.workspace.hidden = !document
    if (!document) {
      window.document.title = BASE_DOCUMENT_TITLE
      return
    }
    window.document.title = `${document.title} | Markdown 工作台`
    elements.documentTitle.textContent = document.title
    const sourceState = document.syncStatus === 'conflict'
      ? '存在版本冲突'
      : document.dirty
        ? (document.remotePath ? '本地修改尚未发布' : '仅保存在本地')
        : '与 GitHub 一致'
    elements.documentMeta.textContent = `${document.fileName} · 更新于 ${formatDate(document.updatedAt)} · ${sourceState}`
    elements.conflict.hidden = document.syncStatus !== 'conflict'
  }

  const renderConnection = () => {
    const locked = isPublishLocked(state.publishJob)
    const document = getActiveDocument()
    elements.connectButton.hidden = state.connected
    elements.disconnectButton.hidden = !state.connected
    elements.syncButton.disabled = !state.connected
    elements.publishButton.disabled = publishPreparing || !state.connected || !document || locked || document.syncStatus === 'conflict'
    if (locked) elements.publishButton.title = '上一次发布尚未完成；你仍可继续编辑并保存草稿。'
    else if (document?.syncStatus === 'conflict') elements.publishButton.title = '请先处理本地与 GitHub 的版本冲突。'
    else elements.publishButton.removeAttribute('title')
  }

  const renderDeployment = () => {
    const job = state.publishJob
    elements.deployment.hidden = !job
    if (!job) return
    const presentation = {
      committing: ['正在提交', '正在把本次发布快照写入 GitHub。编辑器仍可继续修改并保存下一版草稿。', 22],
      deploying: ['正在构建与部署', '提交已经完成，正在等待 GitHub Actions 将页面部署到公开站点。', job.progress || 62],
      deployed: ['发布完成', '所有访客现在都可以看到本次发布的内容。', 100],
      failed: ['发布失败', job.message || '本次提交失败，可以修正后重新发布。', 0],
      timed_out: ['等待超时', '十分钟内没有检测到目标版本。发布锁仍保留，请检查构建状态后重新检查或结束等待。', 82],
      cancelled: ['已结束等待', '工作台已解除发布锁；请先确认 GitHub 构建状态再发起下一次发布。', 0]
    }[job.status] || ['发布状态', job.message || '', 0]
    elements.deploymentTitle.textContent = presentation[0]
    elements.deploymentMessage.textContent = job.message || presentation[1]
    elements.progressBar.style.width = `${presentation[2]}%`
    elements.deploymentError.textContent = job.errorDetail || ''
    elements.deploymentError.hidden = !job.errorDetail
    elements.liveLink.hidden = job.status !== 'deployed' || !job.publishedUrl
    if (job.publishedUrl) elements.liveLink.href = job.publishedUrl
    elements.actionsLink.hidden = !job.actionsUrl
    if (job.actionsUrl) elements.actionsLink.href = job.actionsUrl
    elements.deploymentRecheck.hidden = job.status !== 'timed_out'
    elements.deploymentUnlock.hidden = job.status !== 'timed_out'
  }

  const render = () => {
    renderDocumentList()
    renderActiveDocument()
    renderConnection()
    renderDeployment()
    renderModeSwitch()
  }

  const selectDocument = (id, options = {}) => {
    if (!state.documents.some(document => document.id === id)) return
    if (state.activeId && state.activeId !== id) saveActiveDocument({ silent: true, noRender: true })
    state.activeId = id
    updatePageUrl(id, options.replace ? 'replaceState' : 'pushState')
    loadActiveDocumentIntoEditor()
    render()
  }

  const parseRemoteTimestamp = (frontMatter, key, fallback = Date.now()) => {
    const timestamp = Date.parse(readFrontMatterValue(frontMatter, key))
    return Number.isFinite(timestamp) ? timestamp : fallback
  }

  const readRemoteDocument = async (directory, repository) => {
    const baseEndpoint = repositoryEndpoint(repository)
    const remotePath = `${repository.basePath}/${directory.name}/index.md`
    const endpoint = `${baseEndpoint}/contents/${encodePath(remotePath)}?ref=${encodeURIComponent(repository.branch)}`
    const file = await githubRequest(endpoint, { allow404: true })
    if (!file) return null
    const content = file.content ? normalizeContent(decodeBase64(file.content)) : await githubRequest(endpoint, { raw: true })
    const parsed = splitFrontMatter(content)
    if (readFrontMatterValue(parsed.frontMatter, 'managed') !== 'true') return null
    const slug = directory.name
    const editableContent = stripManagedDocumentChrome(content)
    return {
      id: `remote-${slug}`,
      fileName: `${slug}.md`,
      title: deriveTitle(editableContent, `${slug}.md`),
      content: editableContent,
      createdAt: parseRemoteTimestamp(parsed.frontMatter, 'date'),
      updatedAt: parseRemoteTimestamp(parsed.frontMatter, 'updated'),
      publishedAt: Date.now(),
      publishedUrl: new URL(`/pages/${slug}/`, root.dataset.siteUrl || window.location.origin).href,
      remotePath,
      sha: String(file.sha || ''),
      slug,
      version: readManagedVersion(content),
      baseContentHash: contentHash(editableContent),
      publishedHash: contentHash(editableContent),
      dirty: false,
      syncStatus: 'clean'
    }
  }

  const syncRemoteDocuments = async () => {
    if (!state.connected || !state.repository) throw new Error('请先连接 GitHub。')
    saveActiveDocument({ silent: true, noRender: true })
    const repository = state.repository
    const baseEndpoint = repositoryEndpoint(repository)
    setConnectionStatus('正在读取远程文稿…', 'working')
    const listing = await githubRequest(`${baseEndpoint}/contents/${encodePath(repository.basePath)}?ref=${encodeURIComponent(repository.branch)}`, { allow404: true })
    const directories = Array.isArray(listing) ? listing.filter(entry => entry.type === 'dir') : []
    const remoteDocuments = (await Promise.all(directories.map(directory => readRemoteDocument(directory, repository)))).filter(Boolean)
    const active = getActiveDocument()
    const activeRemotePath = active?.remotePath || ''
    state.documents = mergeRemoteDocuments(state.documents, remoteDocuments)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const requestedSlug = new URL(window.location.href).searchParams.get('remote')
    const requested = requestedSlug && state.documents.find(document => document.slug === requestedSlug)
    const previous = activeRemotePath && state.documents.find(document => document.remotePath === activeRemotePath)
    if (requested) state.activeId = requested.id
    else if (previous) state.activeId = previous.id
    else if (!state.documents.some(document => document.id === state.activeId)) state.activeId = state.documents[0]?.id || null
    persistDocuments()
    loadActiveDocumentIntoEditor()
    render()
    const conflicts = state.documents.filter(document => document.syncStatus === 'conflict').length
    setConnectionStatus(`已连接 ${repository.owner}/${repository.repo}，同步 ${remoteDocuments.length} 个页面${conflicts ? `；${conflicts} 个需要处理版本冲突` : ''}。`, conflicts ? 'warning' : 'success')
    return remoteDocuments.length
  }

  const probeActionsPermission = async repository => {
    try {
      await githubRequest(`${repositoryEndpoint(repository)}/actions/runs?per_page=1`)
      actionsReadable = true
      return true
    } catch (error) {
      if ([403, 404].includes(error.status)) {
        actionsReadable = false
        return false
      }
      actionsReadable = null
      return null
    }
  }

  const connectGithub = async (options = {}) => {
    const repository = repositoryFromFields()
    const suppliedToken = elements.token.value.trim()
    githubToken = suppliedToken || githubToken || sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
    if (!githubToken) throw new Error('请输入 fine-grained personal access token。')
    elements.connectButton.disabled = true
    setConnectionStatus(options.restoring ? '正在恢复当前标签页的 GitHub 连接…' : '正在验证仓库权限…', 'working')
    try {
      const information = await githubRequest(repositoryEndpoint(repository))
      if (information.permissions && information.permissions.push === false) throw new Error('当前令牌没有该仓库的写入权限。')
      state.repository = repository
      state.connected = true
      sessionStorage.setItem(SESSION_TOKEN_KEY, githubToken)
      localStorage.setItem(REPOSITORY_KEY, JSON.stringify(repository))
      elements.token.value = ''
      render()
      const count = await syncRemoteDocuments()
      const canReadActions = await probeActionsPermission(repository)
      if (canReadActions === false) {
        setConnectionStatus(`已连接 ${repository.owner}/${repository.repo}，但令牌缺少 Actions 读取权限；发布后只能通过公开页面判断是否完成。`, 'warning')
      }
      if (isPublishLocked(state.publishJob)) watchDeployment(state.publishJob)
      if (!options.restoring) announce(`GitHub 已连接，共同步 ${count} 个共享页面。`)
    } catch (error) {
      state.connected = false
      state.repository = null
      githubToken = ''
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
      setConnectionStatus(`连接失败：${error.message}`, 'error')
      render()
      throw error
    } finally {
      elements.connectButton.disabled = false
    }
  }

  const disconnectGithub = () => {
    githubToken = ''
    state.connected = false
    state.repository = null
    actionsReadable = null
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    setConnectionStatus('已断开连接；令牌已从当前标签页移除，本地草稿仍然保留。')
    render()
  }

  const checkWorkflow = async (job, options = {}) => {
    if (!job?.commitSha || !githubToken || !state.connected || actionsReadable === false) return { available: false, terminal: false }
    const repository = job.repository || state.repository
    if (!repository) return { available: false, terminal: false }
    const baseEndpoint = repositoryEndpoint(repository)
    try {
      const runs = await githubRequest(`${baseEndpoint}/actions/runs?head_sha=${encodeURIComponent(job.commitSha)}&event=push&per_page=10`)
      const run = runs?.workflow_runs?.find(candidate => candidate.head_sha === job.commitSha) || null
      let jobs = []
      if (run) {
        const response = await githubRequest(`${baseEndpoint}/actions/runs/${encodeURIComponent(run.id)}/jobs?per_page=100`)
        jobs = Array.isArray(response?.jobs) ? response.jobs : []
      }
      actionsReadable = true
      const workflow = deriveWorkflowState(run, jobs)
      if (workflow.status === 'failed') {
        let errorDetail = ''
        if (workflow.failedJobId) {
          try {
            const log = await githubRequest(`${baseEndpoint}/actions/jobs/${encodeURIComponent(workflow.failedJobId)}/logs`, { raw: true })
            errorDetail = extractWorkflowLogError(log)
          } catch {
            // 失败步骤与构建详情链接仍足以定位；日志下载失败不影响状态更新。
          }
        }
        const firstFailure = state.publishJob?.status !== 'failed'
        state.publishJob = {
          ...state.publishJob,
          actionsUrl: workflow.runUrl || state.publishJob.actionsUrl,
          completedAt: Date.now(),
          errorDetail: errorDetail || workflow.failedStep || '',
          message: workflow.message,
          progress: 0,
          status: 'failed',
          workflowRunId: run?.id || null
        }
        persistPublishJob()
        render()
        if (firstFailure || options.manual) announce(`构建失败：${errorDetail || workflow.message}`, 'error')
        return { available: true, terminal: true, workflow }
      }
      state.publishJob = {
        ...state.publishJob,
        actionsUrl: workflow.runUrl || state.publishJob.actionsUrl,
        message: workflow.message,
        progress: workflow.progress,
        workflowRunId: run?.id || null
      }
      persistPublishJob()
      render()
      return { available: true, terminal: false, workflow }
    } catch (error) {
      if ([403, 404].includes(error.status)) {
        actionsReadable = false
        if (options.manual) announce('当前令牌无法读取 GitHub Actions；仍会继续检查公开页面。', 'error')
        return { available: false, terminal: false }
      }
      return { available: null, terminal: false }
    }
  }

  const checkDeployment = async (job, options = {}) => {
    if (!job?.publishedUrl || !job.version) return false
    try {
      const response = await fetch(`${job.publishedUrl}?managed-version=${encodeURIComponent(job.version)}&t=${Date.now()}`, { cache: 'no-store' })
      const html = response.ok ? await response.text() : ''
      if (html.includes(`data-version="${job.version}"`)) {
        state.publishJob = { ...job, status: 'deployed', completedAt: Date.now(), message: '部署完成，所有访客现在都可以看到本次发布的内容。' }
        persistPublishJob()
        render()
        announce('页面已经部署完成。')
        return true
      }
    } catch {
      // 部署中的临时网络错误会由下一次轮询继续检查。
    }
    if (options.manual) announce('公开页面暂时还没有出现本次发布的版本。', 'error')
    return false
  }

  const watchDeployment = job => {
    const currentRun = ++deploymentRun
    const poll = async () => {
      if (currentRun !== deploymentRun || state.publishJob?.id !== job.id || !isPublishLocked(state.publishJob)) return
      const workflow = await checkWorkflow(state.publishJob)
      if (workflow.terminal) return
      if (await checkDeployment(state.publishJob)) return
      if (Date.now() >= state.publishJob.deadlineAt) {
        state.publishJob = { ...state.publishJob, status: 'timed_out', message: '十分钟内没有检测到目标版本。请查看构建详情，然后重新检查或手动结束等待。' }
        persistPublishJob()
        render()
        return
      }
      setTimeout(poll, 8000)
    }
    setTimeout(poll, 2500)
  }

  const resolvePublishAssets = async (snapshot, slug) => {
    const ids = findAssetIds(snapshot)
    const replacements = {}
    const assets = []
    let total = 0
    for (const id of ids) {
      const record = await mediaStore.get(id)
      if (!record?.blob) throw new Error(`资源 ${id} 已不在当前浏览器中，请重新选择文件。`)
      total += Number(record.size || 0)
      if (total > mediaStore.BATCH_LIMIT) throw new Error('待发布资源合计超过 30 MiB。')
      const paths = buildAssetPaths(ASSET_BASE_PATH, slug, record.remoteName)
      replacements[id] = paths.publicPath
      assets.push({ ...record, ...paths })
    }
    return { assets, content: replaceAssetReferences(snapshot, replacements), ids }
  }

  const validatePublishSnapshot = async (snapshot, assets = []) => {
    const structureErrors = validateMarkdownStructure(snapshot)
    if (structureErrors.length) throw new Error(`Markdown 结构异常：${structureErrors.join('；')}。请先在源码模式修复。`)

    const protectedComponents = adapter.protectMarkdown(snapshot)
    const componentErrors = protectedComponents.entries.flatMap(entry => adapter
      .validateValues(entry.name, entry.values)
      .map(message => `${entry.label}：${message}`))
    if (componentErrors.length) throw new Error(`组件参数不完整：${componentErrors.join('；')}`)

    const publishedAssets = new Set(assets.map(asset => asset.publicPath))
    const references = findReferencedSitePaths(snapshot).filter(path => !publishedAssets.has(path))
    const baseEndpoint = repositoryEndpoint(state.repository)
    const tree = references.length
      ? await githubRequest(`${baseEndpoint}/git/trees/${encodeURIComponent(state.repository.branch)}?recursive=1`)
      : { tree: [] }
    const repositoryPaths = new Set((tree?.tree || []).map(item => item.path))
    const missing = tree?.truncated
      ? (await Promise.all(references.map(async publicPath => {
          for (const candidate of candidateRepositoryPathsForPublicAsset(publicPath)) {
            const endpoint = `${baseEndpoint}/contents/${encodePath(candidate)}?ref=${encodeURIComponent(state.repository.branch)}`
            if (await githubRequest(endpoint, { allow404: true })) return ''
          }
          return publicPath
        }))).filter(Boolean)
      : references.filter(publicPath => !candidateRepositoryPathsForPublicAsset(publicPath)
          .some(candidate => repositoryPaths.has(candidate)))
    if (missing.length) throw new Error(`以下站内资源不存在：${missing.join('、')}。请上传文件或更正路径。`)
  }

  const createAtomicPublishCommit = async ({ assets, currentExists, prepared }) => {
    const baseEndpoint = repositoryEndpoint(state.repository)
    const branchPath = encodePath(state.repository.branch)
    const reference = await githubRequest(`${baseEndpoint}/git/ref/heads/${branchPath}`)
    const headSha = String(reference?.object?.sha || '')
    if (!headSha) throw new Error('无法读取发布分支的当前提交。')
    const headCommit = await githubRequest(`${baseEndpoint}/git/commits/${encodeURIComponent(headSha)}`)
    const baseTree = String(headCommit?.tree?.sha || '')
    if (!baseTree) throw new Error('无法读取发布分支的文件树。')

    const markdownBlob = await githubRequest(`${baseEndpoint}/git/blobs`, {
      method: 'POST',
      body: { content: encodeBase64(prepared.content), encoding: 'base64' }
    })
    const treeEntries = [{ path: prepared.remotePath, mode: '100644', type: 'blob', sha: markdownBlob.sha }]
    for (const record of assets) {
      const blob = await githubRequest(`${baseEndpoint}/git/blobs`, {
        method: 'POST',
        body: { content: await mediaStore.blobToBase64(record.blob), encoding: 'base64' }
      })
      treeEntries.push({ path: record.remotePath, mode: '100644', type: 'blob', sha: blob.sha })
    }
    const tree = await githubRequest(`${baseEndpoint}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseTree, tree: treeEntries }
    })
    const commit = await githubRequest(`${baseEndpoint}/git/commits`, {
      method: 'POST',
      body: {
        message: `${currentExists ? 'docs: update' : 'docs: publish'} page ${prepared.slug}${assets.length ? ` with ${assets.length} asset${assets.length === 1 ? '' : 's'}` : ''}`,
        tree: tree.sha,
        parents: [headSha]
      }
    })
    await githubRequest(`${baseEndpoint}/git/refs/heads/${branchPath}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false }
    })
    return { commitSha: String(commit.sha || ''), documentSha: String(markdownBlob.sha || '') }
  }

  const publishActiveDocument = async () => {
    if (!state.connected || !state.repository) {
      announce('请先连接具有 Contents 写入权限的 GitHub 仓库。', 'error')
      return
    }
    if (isPublishLocked(state.publishJob)) {
      announce('上一次发布尚未完成；当前修改会继续保存为草稿，部署完成后再发布。', 'error')
      return
    }
    if (publishPreparing) return
    publishPreparing = true
    renderConnection()
    const document = saveActiveDocument({ silent: true })
    if (!document) { publishPreparing = false; renderConnection(); return }
    if (document.syncStatus === 'conflict') {
      publishPreparing = false
      renderConnection()
      announce('请先处理本地与 GitHub 的版本冲突。', 'error')
      return
    }

    const snapshot = document.content
    let assetResolution
    let prepared
    try {
      const slug = slugify(document.slug || document.fileName.replace(/\.md$/i, ''))
      assetResolution = await resolvePublishAssets(snapshot, slug)
      await validatePublishSnapshot(assetResolution.content, assetResolution.assets)
      prepared = prepareManagedDocument(assetResolution.content, {
        basePath: state.repository.basePath,
        fileName: document.fileName,
        slug
      })
    } catch (error) {
      publishPreparing = false
      renderConnection()
      announce(`发布前检查失败：${error.message}`, 'error')
      return
    }
    const snapshotHash = contentHash(snapshot)
    const publishedUrl = new URL(prepared.pagePath, root.dataset.siteUrl || window.location.origin).href
    const actionsUrl = `https://github.com/${encodeURIComponent(state.repository.owner)}/${encodeURIComponent(state.repository.repo)}/actions`
    state.publishJob = {
      ...createPublishJob({
        documentId: document.id,
        pagePath: prepared.pagePath,
        remotePath: prepared.remotePath,
        snapshotHash,
        timeoutMs: PUBLISH_TIMEOUT_MS,
        version: prepared.version
      }),
      actionsUrl,
      publishedUrl,
      repository: { ...state.repository }
    }
    persistPublishJob()
    publishPreparing = false
    render()

    try {
      const baseEndpoint = repositoryEndpoint(state.repository)
      const contentEndpoint = `${baseEndpoint}/contents/${encodePath(prepared.remotePath)}`
      const current = await githubRequest(`${contentEndpoint}?ref=${encodeURIComponent(state.repository.branch)}`, { allow404: true })
      if (current && !document.remotePath) throw new Error(`共享页面“${prepared.slug}”已存在。请先重新同步再继续。`)
      if (current && document.sha && current.sha !== document.sha) throw new Error('GitHub 文稿在本次编辑期间发生了变化。请重新同步并处理版本冲突。')

      const result = await createAtomicPublishCommit({ assets: assetResolution.assets, currentExists: Boolean(current), prepared })

      const latestDocument = state.documents.find(item => item.id === document.id)
      const publishedEditableContent = stripManagedDocumentChrome(prepared.content)
      const publishedEditableHash = contentHash(publishedEditableContent)
      let shouldReloadPublishedDocument = false
      if (latestDocument) {
        if (contentHash(latestDocument.content) === snapshotHash) {
          latestDocument.content = publishedEditableContent
          shouldReloadPublishedDocument = latestDocument.id === state.activeId
        }
        latestDocument.title = prepared.title
        latestDocument.fileName = `${prepared.slug}.md`
        latestDocument.slug = prepared.slug
        latestDocument.remotePath = prepared.remotePath
        latestDocument.sha = result.documentSha
        latestDocument.version = prepared.version
        latestDocument.publishedAt = Date.now()
        latestDocument.publishedUrl = publishedUrl
        latestDocument.baseContentHash = publishedEditableHash
        latestDocument.publishedHash = publishedEditableHash
        latestDocument.dirty = contentHash(latestDocument.content) !== publishedEditableHash
        latestDocument.syncStatus = latestDocument.dirty ? 'local-ahead' : 'clean'
      }
      persistDocuments()
      if (latestDocument && !findAssetIds(latestDocument.content).length && assetResolution.ids.length) {
        await mediaStore.removeMany(assetResolution.ids)
        assetResolution.ids.forEach(id => {
          const url = assetObjectUrls.get(id)
          if (url) { URL.revokeObjectURL(url); previewUrlToReference.delete(url); assetObjectUrls.delete(id) }
        })
      }
      if (shouldReloadPublishedDocument) loadActiveDocumentIntoEditor()
      state.publishJob = {
        ...state.publishJob,
        commitSha: result.commitSha,
        status: 'deploying',
        message: '提交已完成，正在等待 GitHub Actions 构建和部署。你可以继续编辑下一版草稿。'
      }
      persistPublishJob()
      render()
      announce('文稿已提交，正在等待部署。')
      watchDeployment(state.publishJob)
    } catch (error) {
      console.error('发布 Markdown 页面失败。', error)
      state.publishJob = { ...state.publishJob, status: 'failed', message: `发布失败：${error.message}` }
      persistPublishJob()
      render()
      announce(`发布失败：${error.message}`, 'error')
    }
  }

  const resolveConflict = choice => {
    const document = getActiveDocument()
    if (!document || document.syncStatus !== 'conflict') return
    if (choice === 'remote') {
      document.content = document.conflictRemoteContent
      document.baseContentHash = contentHash(document.content)
      document.publishedHash = document.baseContentHash
      document.dirty = false
      document.syncStatus = 'clean'
    } else {
      document.baseContentHash = contentHash(document.conflictRemoteContent)
      document.dirty = contentHash(document.content) !== document.baseContentHash
      document.syncStatus = document.dirty ? 'local-ahead' : 'clean'
    }
    document.sha = document.conflictRemoteSha || document.sha
    document.conflictRemoteContent = ''
    document.conflictRemoteSha = ''
    persistDocuments()
    loadActiveDocumentIntoEditor()
    render()
    announce(choice === 'remote' ? '已切换为 GitHub 版本。' : '已保留本地版本；下一次发布会基于最新 GitHub 版本更新。')
  }

  const downloadText = (content, fileName) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadActiveDocument = () => {
    const document = saveActiveDocument({ silent: true })
    if (document) downloadText(document.content, document.fileName)
  }

  const downloadConflictVersions = () => {
    const document = getActiveDocument()
    if (!document?.conflictRemoteContent) return
    downloadText(document.content, document.fileName.replace(/\.md$/i, '-local.md'))
    setTimeout(() => downloadText(document.conflictRemoteContent, document.fileName.replace(/\.md$/i, '-github.md')), 250)
  }

  const importFiles = async fileList => {
    const files = Array.from(fileList || [])
    const imported = []
    const rejected = []
    for (const file of files) {
      if (!/\.md$/i.test(file.name)) {
        rejected.push(`${file.name}（不是 .md 文件）`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name}（超过 2 MiB）`)
        continue
      }
      try {
        const content = normalizeContent(await file.text())
        const now = Date.now()
        imported.push(migrateDocument({
          id: createId(file.name),
          fileName: file.name,
          title: deriveTitle(content, file.name),
          content,
          createdAt: now,
          updatedAt: now
        }))
      } catch {
        rejected.push(`${file.name}（读取失败）`)
      }
    }
    if (imported.length) {
      saveActiveDocument({ silent: true, noRender: true })
      state.documents = [...imported, ...state.documents]
      state.activeId = imported[0].id
      persistDocuments()
      updatePageUrl(state.activeId)
      loadActiveDocumentIntoEditor()
      render()
    }
    announce(`已导入 ${imported.length} 份文稿${rejected.length ? `；${rejected.length} 份未导入：${rejected.join('、')}` : ''}。`, rejected.length && !imported.length ? 'error' : 'success')
    elements.fileInput.value = ''
  }

  const importAssets = async fileList => {
    const files = Array.from(fileList || [])
    const errors = []
    let added = 0
    const fieldPath = pendingAssetFieldPath
    for (const file of files) {
      try {
        const record = await stageAsset(file)
        added += 1
        if (fieldPath && activeComponentValues && added === 1) {
          setValueAtPath(activeComponentValues, fieldPath, assetReference(record.id))
          renderComponentFields()
        } else if (!fieldPath) insertAssetRecord(record)
      } catch (error) {
        errors.push(`${file.name}：${error.message}`)
      }
    }
    pendingAssetFieldPath = null
    elements.assetInput.value = ''
    if (added || errors.length) announce(`已添加 ${added} 个资源${errors.length ? `；${errors.join('；')}` : ''}。`, errors.length && !added ? 'error' : 'success')
  }

  const handleEditorShortcut = event => {
    const primary = event.metaKey || event.ctrlKey
    if (primary && event.key.toLowerCase() === 's') {
      event.preventDefault()
      saveActiveDocument()
      return
    }
    if (event.altKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault()
      editor.exec('heading', { level: Number(event.key) })
      return
    }
    if (primary && event.shiftKey && ['7', '8', '9'].includes(event.key)) {
      event.preventDefault()
      editor.exec({ 7: 'orderedList', 8: 'bulletList', 9: 'blockQuote' }[event.key])
      return
    }
    if (primary && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      editor.exec('addLink', { linkText: editor.getSelectedText() || '链接文字', linkUrl: 'https://example.com' })
    }
  }

  const bindEvents = () => {
    elements.fileInput.addEventListener('change', event => importFiles(event.target.files))
    elements.assetInput.addEventListener('change', event => importAssets(event.target.files))
    elements.saveButton.addEventListener('click', () => saveActiveDocument())
    elements.downloadButton.addEventListener('click', downloadActiveDocument)
    elements.publishButton.addEventListener('click', publishActiveDocument)
    elements.wysiwygTab.addEventListener('click', () => switchMode('wysiwyg').catch(error => announce(error.message, 'error')))
    elements.markdownTab.addEventListener('click', () => switchMode('markdown').catch(error => announce(error.message, 'error')))
    elements.frontMatter.addEventListener('input', markUnsaved)
    elements.componentTools.addEventListener('click', event => {
      const button = event.target.closest('[data-component]')
      if (button) insertButterflyComponent(button.dataset.component)
    })
    elements.richEditor.addEventListener('click', event => {
      const widget = event.target.closest('.mdw-butterfly-widget')
      if (widget) openComponentDialog(widget.dataset.componentId)
    })
    elements.richEditor.addEventListener('keydown', event => {
      const widget = event.target.closest?.('.mdw-butterfly-widget')
      if (widget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        openComponentDialog(widget.dataset.componentId)
        return
      }
      handleEditorShortcut(event)
    })
    elements.componentSave.addEventListener('click', event => {
      event.preventDefault()
      updateActiveComponent('save')
    })
    elements.componentDelete.addEventListener('click', event => {
      event.preventDefault()
      updateActiveComponent('delete')
    })
    elements.componentDialog.addEventListener('close', () => {
      if (pendingSourceComponentId) componentEntries = componentEntries.filter(item => item.id !== pendingSourceComponentId)
      if (pendingVisualComponentId) {
        const pending = componentEntries.find(item => item.id === pendingVisualComponentId)
        const markdown = pending ? editor.getMarkdown().split(pending.placeholder).join('') : editor.getMarkdown()
        componentEntries = componentEntries.filter(item => item.id !== pendingVisualComponentId)
        suppressEditorChange = true
        editor.setMarkdown(markdown, false)
        requestAnimationFrame(() => {
          suppressEditorChange = false
          markUnsaved()
        })
      }
      activeComponentId = ''
      activeComponentValues = null
      pendingAssetFieldPath = null
      pendingSourceComponentId = ''
      pendingVisualComponentId = ''
    })
    elements.connectButton.addEventListener('click', () => connectGithub().catch(error => console.error(error)))
    elements.syncButton.addEventListener('click', () => syncRemoteDocuments().then(count => announce(`已重新同步 ${count} 个共享页面。`)).catch(error => announce(`同步失败：${error.message}`, 'error')))
    elements.disconnectButton.addEventListener('click', disconnectGithub)
    elements.conflictDownload.addEventListener('click', downloadConflictVersions)
    elements.conflictLocal.addEventListener('click', () => resolveConflict('local'))
    elements.conflictRemote.addEventListener('click', () => resolveConflict('remote'))
    elements.deploymentRecheck.addEventListener('click', async () => {
      const workflow = await checkWorkflow(state.publishJob, { manual: true })
      if (!workflow.terminal) await checkDeployment(state.publishJob, { manual: true })
    })
    elements.deploymentUnlock.addEventListener('click', () => {
      if (!window.confirm('结束等待会解除发布锁。请先确认 GitHub Actions 不会继续部署旧版本，确定继续吗？')) return
      deploymentRun += 1
      state.publishJob = { ...state.publishJob, status: 'cancelled', message: '已手动结束等待并解除发布锁。' }
      persistPublishJob()
      render()
    })
    window.addEventListener('popstate', () => {
      const id = new URL(window.location.href).searchParams.get('doc')
      if (id && state.documents.some(document => document.id === id)) selectDocument(id, { replace: true })
    })
    window.addEventListener('storage', event => {
      if (event.key !== PUBLISH_JOB_KEY) return
      state.publishJob = event.newValue ? JSON.parse(event.newValue) : null
      render()
      if (isPublishLocked(state.publishJob)) watchDeployment(state.publishJob)
    })
    channel?.addEventListener('message', event => {
      if (event.data?.type !== 'publish-job') return
      state.publishJob = event.data.job
      render()
      if (isPublishLocked(state.publishJob)) watchDeployment(state.publishJob)
    })
    window.addEventListener('beforeunload', () => {
      saveActiveDocument({ silent: true, noRender: true })
      assetObjectUrls.forEach(url => URL.revokeObjectURL(url))
    })
  }

  const initialize = () => {
    state.documents = loadDocuments()
    state.publishJob = loadJson(localStorage, PUBLISH_JOB_KEY, null)
    const repository = loadRepositorySettings()
    elements.owner.value = repository.owner
    elements.repo.value = repository.repo
    elements.branch.value = repository.branch
    const url = new URL(window.location.href)
    const requestedId = url.searchParams.get('doc')
    state.activeId = state.documents.some(document => document.id === requestedId) ? requestedId : state.documents[0]?.id || null
    renderComponentTools()
    initializeEditor()
    bindEvents()
    if (state.activeId) {
      loadActiveDocumentIntoEditor()
      updatePageUrl(state.activeId, 'replaceState')
    }
    render()
    if (isPublishLocked(state.publishJob)) watchDeployment(state.publishJob)
    githubToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
    if (githubToken) connectGithub({ restoring: true }).catch(error => console.warn('恢复 GitHub 连接失败。', error))
  }

  initialize()
})()
