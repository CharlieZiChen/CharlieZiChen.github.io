(() => {
  'use strict'

  const root = document.getElementById('md-workbench')
  if (!root) return

  const core = globalThis.MarkdownEditorCore
  const adapter = globalThis.ButterflyEditorAdapter
  const ToastEditor = globalThis.toastui?.Editor
  if (!core || !adapter || !ToastEditor) {
    console.error('Markdown 工作台依赖未加载。')
    return
  }

  const {
    BUTTERFLY_COMPONENTS,
    contentHash,
    createPublishJob,
    decodeBase64,
    deriveTitle,
    encodeBase64,
    isPublishLocked,
    mergeRemoteDocuments,
    migrateDocument,
    normalizeContent,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    slugify,
    splitFrontMatter,
    stripManagedDocumentChrome
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
    branch: document.getElementById('mdw-branch'),
    componentArgs: document.getElementById('mdw-component-args'),
    componentBody: document.getElementById('mdw-component-body'),
    componentBodyField: document.getElementById('mdw-component-body-field'),
    componentDelete: document.getElementById('mdw-component-delete'),
    componentDialog: document.getElementById('mdw-component-dialog'),
    componentDialogTitle: document.getElementById('mdw-component-dialog-title'),
    componentSave: document.getElementById('mdw-component-save'),
    componentTools: document.getElementById('mdw-component-tools'),
    conflict: document.getElementById('mdw-conflict'),
    conflictDownload: document.getElementById('mdw-conflict-download'),
    conflictLocal: document.getElementById('mdw-conflict-local'),
    conflictRemote: document.getElementById('mdw-conflict-remote'),
    connectButton: document.getElementById('mdw-connect-button'),
    connectionStatus: document.getElementById('mdw-connection-status'),
    deployment: document.getElementById('mdw-deployment'),
    deploymentMessage: document.getElementById('mdw-deployment-message'),
    deploymentRecheck: document.getElementById('mdw-deployment-recheck'),
    deploymentTitle: document.getElementById('mdw-deployment-title'),
    deploymentUnlock: document.getElementById('mdw-deployment-unlock'),
    disconnectButton: document.getElementById('mdw-disconnect-button'),
    documentCount: document.getElementById('mdw-document-count'),
    documentList: document.getElementById('mdw-document-list'),
    documentMeta: document.getElementById('mdw-document-meta'),
    documentTitle: document.getElementById('mdw-document-title'),
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
  let githubToken = ''
  let saveTimer = 0
  let statusTimer = 0
  let deploymentRun = 0
  let suppressEditorChange = false
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

  const createWidget = text => {
    const id = text.match(/BUTTERFLY_COMPONENT_([a-z0-9-]+)/i)?.[1] || ''
    const entry = componentEntries.find(item => item.id === id)
    const card = document.createElement('span')
    card.className = 'mdw-butterfly-widget'
    card.dataset.componentId = id
    card.contentEditable = 'false'
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', `编辑 ${entry?.label || 'Butterfly'} 组件`)
    const badge = document.createElement('span')
    badge.className = 'mdw-butterfly-widget-badge'
    badge.textContent = 'Butterfly'
    const title = document.createElement('strong')
    title.textContent = entry?.label || '主题组件'
    const summary = document.createElement('span')
    summary.className = 'mdw-butterfly-widget-summary'
    summary.textContent = entry ? adapter.summarizeEntry(entry) : '组件数据将在保存时保留'
    const action = document.createElement('span')
    action.className = 'mdw-butterfly-widget-action'
    action.textContent = '编辑'
    card.append(badge, title, summary, action)
    return card
  }

  const markUnsaved = () => {
    if (suppressEditorChange || !getActiveDocument()) return
    elements.saveState.textContent = '正在修改…'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveActiveDocument({ silent: true }), 700)
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
      events: { change: markUnsaved }
    })
  }

  const readEditorBody = () => {
    if (!editor) return ''
    const markdown = normalizeContent(editor.getMarkdown())
    return state.mode === 'wysiwyg' ? adapter.restoreMarkdown(markdown, componentEntries) : markdown
  }

  const composeDocument = () => {
    const body = readEditorBody().replace(/^\n+/, '').replace(/\s+$/, '')
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

  const loadActiveDocumentIntoEditor = () => {
    const document = getActiveDocument()
    if (!document || !editor) return
    const parsed = splitFrontMatter(stripManagedDocumentChrome(document.content))
    elements.frontMatter.value = parsed.frontMatter
    suppressEditorChange = true
    if (state.mode === 'wysiwyg') {
      const protectedBody = adapter.protectMarkdown(parsed.body)
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
      editor.changeMode('wysiwyg', true)
    } else {
      componentEntries = []
      editor.setMarkdown(parsed.body, false)
      editor.changeMode('markdown', true)
    }
    requestAnimationFrame(() => { suppressEditorChange = false })
    elements.saveState.textContent = '已保存'
  }

  const switchMode = mode => {
    if (!editor || mode === state.mode) return
    suppressEditorChange = true
    if (mode === 'markdown') {
      const raw = adapter.restoreMarkdown(editor.getMarkdown(), componentEntries)
      componentEntries = []
      editor.setMarkdown(raw, false)
      editor.changeMode('markdown')
    } else {
      const protectedBody = adapter.protectMarkdown(editor.getMarkdown())
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
      editor.changeMode('wysiwyg')
    }
    state.mode = mode
    renderModeSwitch()
    requestAnimationFrame(() => { suppressEditorChange = false })
  }

  const reloadEditorBody = body => {
    suppressEditorChange = true
    if (state.mode === 'wysiwyg') {
      const protectedBody = adapter.protectMarkdown(body)
      componentEntries = protectedBody.entries
      editor.setMarkdown(protectedBody.markdown, false)
    } else {
      componentEntries = []
      editor.setMarkdown(body, false)
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
      const selection = component.select || component.placeholder || ''
      editor.insertText(String(component.snippet).replace('{{selection}}', selection))
    } else {
      const entry = adapter.entryFromComponent(component)
      if (!entry) return
      componentEntries.push(entry)
      editor.insertText(`${component.inline ? '' : '\n'}${entry.placeholder}${component.inline ? '' : '\n'}`)
    }
    editor.focus()
    markUnsaved()
  }

  const openComponentDialog = id => {
    const entry = componentEntries.find(item => item.id === id)
    if (!entry) return
    activeComponentId = id
    elements.componentDialogTitle.textContent = entry.label
    elements.componentArgs.value = entry.args
    elements.componentBody.value = entry.body
    elements.componentBodyField.hidden = !entry.paired
    elements.componentDialog.showModal()
  }

  const updateActiveComponent = action => {
    const entry = componentEntries.find(item => item.id === activeComponentId)
    if (!entry) return
    if (action === 'delete') {
      const markdown = editor.getMarkdown().split(entry.placeholder).join('')
      componentEntries = componentEntries.filter(item => item.id !== entry.id)
      suppressEditorChange = true
      editor.setMarkdown(markdown, false)
      requestAnimationFrame(() => {
        suppressEditorChange = false
        markUnsaved()
      })
    } else if (action === 'save') {
      entry.args = elements.componentArgs.value.trim()
      if (entry.paired) entry.body = normalizeContent(elements.componentBody.value).replace(/^\n|\n$/g, '')
      elements.richEditor.querySelectorAll(`[data-component-id="${entry.id}"] .mdw-butterfly-widget-summary`).forEach(summary => {
        summary.textContent = adapter.summarizeEntry(entry)
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
    elements.publishButton.disabled = !state.connected || !document || locked || document.syncStatus === 'conflict'
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
      deploying: ['正在构建与部署', '提交已经完成，正在等待 GitHub Actions 将页面部署到公开站点。', 62],
      deployed: ['发布完成', '所有访客现在都可以看到本次发布的内容。', 100],
      failed: ['发布失败', job.message || '本次提交失败，可以修正后重新发布。', 0],
      timed_out: ['等待超时', '十分钟内没有检测到目标版本。发布锁仍保留，请检查构建状态后重新检查或结束等待。', 82],
      cancelled: ['已结束等待', '工作台已解除发布锁；请先确认 GitHub 构建状态再发起下一次发布。', 0]
    }[job.status] || ['发布状态', job.message || '', 0]
    elements.deploymentTitle.textContent = presentation[0]
    elements.deploymentMessage.textContent = job.message || presentation[1]
    elements.progressBar.style.width = `${presentation[2]}%`
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
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    setConnectionStatus('已断开连接；令牌已从当前标签页移除，本地草稿仍然保留。')
    render()
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

  const publishActiveDocument = async () => {
    if (!state.connected || !state.repository) {
      announce('请先连接具有 Contents 写入权限的 GitHub 仓库。', 'error')
      return
    }
    if (isPublishLocked(state.publishJob)) {
      announce('上一次发布尚未完成；当前修改会继续保存为草稿，部署完成后再发布。', 'error')
      return
    }
    const document = saveActiveDocument({ silent: true })
    if (!document) return
    if (document.syncStatus === 'conflict') {
      announce('请先处理本地与 GitHub 的版本冲突。', 'error')
      return
    }

    const snapshot = document.content
    const prepared = prepareManagedDocument(snapshot, {
      basePath: state.repository.basePath,
      fileName: document.fileName,
      slug: document.slug || document.fileName.replace(/\.md$/i, '')
    })
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
    render()

    try {
      const baseEndpoint = repositoryEndpoint(state.repository)
      const contentEndpoint = `${baseEndpoint}/contents/${encodePath(prepared.remotePath)}`
      const current = await githubRequest(`${contentEndpoint}?ref=${encodeURIComponent(state.repository.branch)}`, { allow404: true })
      if (current && !document.remotePath) throw new Error(`共享页面“${prepared.slug}”已存在。请先重新同步再继续。`)
      if (current && document.sha && current.sha !== document.sha) throw new Error('GitHub 文稿在本次编辑期间发生了变化。请重新同步并处理版本冲突。')

      const result = await githubRequest(contentEndpoint, {
        method: 'PUT',
        body: {
          message: `${current ? 'docs: update' : 'docs: publish'} page ${prepared.slug}`,
          content: encodeBase64(prepared.content),
          branch: state.repository.branch,
          ...(current?.sha ? { sha: current.sha } : {})
        }
      })

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
        latestDocument.sha = String(result?.content?.sha || '')
        latestDocument.version = prepared.version
        latestDocument.publishedAt = Date.now()
        latestDocument.publishedUrl = publishedUrl
        latestDocument.baseContentHash = publishedEditableHash
        latestDocument.publishedHash = publishedEditableHash
        latestDocument.dirty = contentHash(latestDocument.content) !== publishedEditableHash
        latestDocument.syncStatus = latestDocument.dirty ? 'local-ahead' : 'clean'
      }
      persistDocuments()
      if (shouldReloadPublishedDocument) loadActiveDocumentIntoEditor()
      state.publishJob = {
        ...state.publishJob,
        commitSha: String(result?.commit?.sha || ''),
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
    elements.saveButton.addEventListener('click', () => saveActiveDocument())
    elements.downloadButton.addEventListener('click', downloadActiveDocument)
    elements.publishButton.addEventListener('click', publishActiveDocument)
    elements.wysiwygTab.addEventListener('click', () => switchMode('wysiwyg'))
    elements.markdownTab.addEventListener('click', () => switchMode('markdown'))
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
    elements.componentDialog.addEventListener('close', () => { activeComponentId = '' })
    elements.connectButton.addEventListener('click', () => connectGithub().catch(error => console.error(error)))
    elements.syncButton.addEventListener('click', () => syncRemoteDocuments().then(count => announce(`已重新同步 ${count} 个共享页面。`)).catch(error => announce(`同步失败：${error.message}`, 'error')))
    elements.disconnectButton.addEventListener('click', disconnectGithub)
    elements.conflictDownload.addEventListener('click', downloadConflictVersions)
    elements.conflictLocal.addEventListener('click', () => resolveConflict('local'))
    elements.conflictRemote.addEventListener('click', () => resolveConflict('remote'))
    elements.deploymentRecheck.addEventListener('click', () => checkDeployment(state.publishJob, { manual: true }))
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
    window.addEventListener('beforeunload', () => saveActiveDocument({ silent: true, noRender: true }))
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
