(() => {
  'use strict'

  const root = document.getElementById('md-workbench')
  if (!root) return

  const core = globalThis.MarkdownEditorCore
  if (!core) {
    console.error('Markdown 编辑器核心模块未加载。')
    return
  }

  const {
    applyTextEdit,
    BUTTERFLY_COMPONENTS,
    decodeBase64,
    deriveTitle,
    encodeBase64,
    normalizeContent,
    normalizeMarkdownStructure,
    prepareManagedDocument,
    readFrontMatterValue,
    readManagedVersion,
    slugify,
    splitFrontMatter,
    splitMarkdownBlocks,
    stripManagedDocumentChrome
  } = core

  const STORAGE_KEY = root.dataset.storageKey || 'charliezc.md-pages.v1'
  const REPOSITORY_KEY = `${STORAGE_KEY}.repository`
  const GITHUB_API_VERSION = '2026-03-10'
  const MAX_FILE_BYTES = 2 * 1024 * 1024
  const BASE_DOCUMENT_TITLE = document.title
  const elements = {
    fileInput: document.getElementById('mdw-file-input'),
    status: document.getElementById('mdw-status'),
    documentCount: document.getElementById('mdw-document-count'),
    documentList: document.getElementById('mdw-document-list'),
    libraryEmpty: document.getElementById('mdw-library-empty'),
    emptyState: document.getElementById('mdw-empty-state'),
    viewMode: document.getElementById('mdw-view-mode'),
    editMode: document.getElementById('mdw-edit-mode'),
    documentTitle: document.getElementById('mdw-document-title'),
    documentMeta: document.getElementById('mdw-document-meta'),
    preview: document.getElementById('mdw-preview'),
    editor: document.getElementById('mdw-editor'),
    sourceTab: document.getElementById('mdw-source-tab'),
    previewTab: document.getElementById('mdw-preview-tab'),
    sourcePanel: document.getElementById('mdw-source-panel'),
    editPreviewPanel: document.getElementById('mdw-edit-preview-panel'),
    editPreview: document.getElementById('mdw-edit-preview'),
    previewSelection: document.getElementById('mdw-preview-selection'),
    componentTools: document.getElementById('mdw-component-tools'),
    editButton: document.getElementById('mdw-edit-button'),
    saveButton: document.getElementById('mdw-save-button'),
    cancelButton: document.getElementById('mdw-cancel-button'),
    downloadButton: document.getElementById('mdw-download-button'),
    owner: document.getElementById('mdw-owner'),
    repo: document.getElementById('mdw-repo'),
    branch: document.getElementById('mdw-branch'),
    token: document.getElementById('mdw-token'),
    connectButton: document.getElementById('mdw-connect-button'),
    syncButton: document.getElementById('mdw-sync-button'),
    disconnectButton: document.getElementById('mdw-disconnect-button'),
    connectionStatus: document.getElementById('mdw-connection-status'),
    publishButton: document.getElementById('mdw-publish-button'),
    publishEditButton: document.getElementById('mdw-publish-edit-button'),
    deployment: document.getElementById('mdw-deployment'),
    deploymentMessage: document.getElementById('mdw-deployment-message'),
    liveLink: document.getElementById('mdw-live-link'),
    actionsLink: document.getElementById('mdw-actions-link')
  }
  const state = {
    documents: [],
    activeId: null,
    editing: false,
    editSurface: 'source',
    previewSelection: null,
    sourceSelection: { start: 0, end: 0 },
    originalContent: '',
    connected: false,
    publishing: false,
    repository: null
  }
  let githubToken = ''
  let deploymentRun = 0
  let statusTimer = null

  const escapeHtml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const createId = fileName => {
    const randomPart = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
    return `${slugify(fileName.replace(/\.md$/i, ''))}-${Date.now().toString(36)}-${randomPart}`
  }

  const formatDate = timestamp => new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp))

  const announce = (message, type = 'success') => {
    clearTimeout(statusTimer)
    elements.status.textContent = message
    elements.status.className = `mdw-status${type === 'error' ? ' mdw-status-error' : ''}`
    elements.status.hidden = false
    statusTimer = setTimeout(() => {
      elements.status.hidden = true
    }, 6000)
  }

  const loadDocuments = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      if (!Array.isArray(stored)) return []

      return stored
        .filter(doc => doc && typeof doc.id === 'string' && typeof doc.content === 'string')
        .map(doc => ({
          id: doc.id,
          fileName: String(doc.fileName || '未命名文稿.md'),
          title: String(doc.title || deriveTitle(doc.content, doc.fileName)),
          content: normalizeContent(doc.content),
          createdAt: Number(doc.createdAt) || Date.now(),
          updatedAt: Number(doc.updatedAt) || Date.now(),
          publishedAt: Number(doc.publishedAt) || 0,
          publishedUrl: String(doc.publishedUrl || ''),
          remotePath: String(doc.remotePath || ''),
          sha: String(doc.sha || ''),
          slug: String(doc.slug || ''),
          version: String(doc.version || '')
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    } catch (error) {
      console.warn('无法读取 Markdown 工作台数据。', error)
      return []
    }
  }

  const persistDocuments = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.documents))
  }

  const defaultRepository = {
    owner: root.dataset.defaultOwner || '',
    repo: root.dataset.defaultRepo || '',
    branch: root.dataset.defaultBranch || 'main',
    basePath: root.dataset.basePath || 'source/pages'
  }

  const loadRepositorySettings = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(REPOSITORY_KEY) || '{}')
      if (stored.owner === 'CharlieZiChen' && stored.repo === 'CharlieZiChen.github.io') {
        stored.repo = defaultRepository.repo
      }
      return { ...defaultRepository, ...stored, basePath: defaultRepository.basePath }
    } catch {
      return { ...defaultRepository }
    }
  }

  const repositoryFromFields = () => ({
    owner: elements.owner.value.trim(),
    repo: elements.repo.value.trim(),
    branch: elements.branch.value.trim() || 'main',
    basePath: defaultRepository.basePath
  })

  const validateRepository = repository => {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(repository.owner)) throw new Error('GitHub 所有者名称格式不正确。')
    if (!/^[A-Za-z0-9._-]+$/.test(repository.repo)) throw new Error('GitHub 仓库名称格式不正确。')
    if (!repository.branch || /\s|[\u0000-\u001f\u007f~^:?*[\\]/.test(repository.branch)) throw new Error('Git 分支名称格式不正确。')
    return repository
  }

  const encodePath = value => String(value).split('/').map(encodeURIComponent).join('/')

  const githubRequest = async (endpoint, options = {}) => {
    if (!githubToken) throw new Error('请先连接 GitHub。')
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    })

    if (options.allow404 && response.status === 404) return null
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.json()).message || ''
      } catch {
        detail = await response.text()
      }
      const error = new Error(detail || `GitHub API 请求失败（${response.status}）。`)
      error.status = response.status
      throw error
    }
    return response.status === 204 ? null : response.json()
  }

  const githubRawRequest = async endpoint => {
    if (!githubToken) throw new Error('请先连接 GitHub。')
    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION
      }
    })
    if (!response.ok) throw new Error(`无法读取远程 Markdown（${response.status}）。`)
    return normalizeContent(await response.text())
  }

  const repositoryEndpoint = repository => `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`

  const setConnectionStatus = (message, type = 'idle') => {
    elements.connectionStatus.textContent = message
    elements.connectionStatus.dataset.state = type
  }

  const updateConnectionUi = () => {
    const hasDocument = Boolean(getActiveDocument())
    elements.connectButton.hidden = state.connected
    elements.disconnectButton.hidden = !state.connected
    elements.syncButton.disabled = !state.connected || state.publishing
    elements.publishButton.disabled = !state.connected || !hasDocument || state.publishing
    elements.publishEditButton.disabled = !state.connected || !hasDocument || state.publishing
    elements.owner.disabled = state.connected
    elements.repo.disabled = state.connected
    elements.branch.disabled = state.connected
    elements.token.disabled = state.connected
  }

  const safeUrl = (value, image = false) => {
    const url = String(value || '').trim().replace(/^<|>$/g, '')
    if (!url || /[\u0000-\u001f\u007f\s]/.test(url)) return null
    if (/^(?:https?:)?\/\//i.test(url)) return url
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('#')) return url
    if (!image && /^mailto:/i.test(url)) return url
    return null
  }

  const renderInline = source => {
    const tokens = []
    const stash = html => {
      const index = tokens.push(html) - 1
      return `\u0000${index}\u0000`
    }
    let text = String(source || '')

    text = text.replace(/{%\s*label\s+(.+?)\s*%}/g, (_, raw) => {
      const parts = raw.trim().split(/\s+/)
      const color = /^[\w-]+$/.test(parts.at(-1) || '') ? parts.pop() : 'blue'
      return stash(`<mark class="mdw-butterfly-label mdw-color-${escapeHtml(color)}">${escapeHtml(parts.join(' ') || '标签')}</mark>`)
    })
    text = text.replace(/{%\s*btn\s+(.+?)\s*%}/g, (_, raw) => {
      const [rawUrl, label = '按钮'] = raw.split(',').map(value => value.trim())
      const url = safeUrl(rawUrl)
      if (!url) return stash(`<span class="mdw-butterfly-button">${escapeHtml(label)}</span>`)
      return stash(`<a class="mdw-butterfly-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
    })
    text = text.replace(/{%\s*inlineImg\s+(\S+)(?:\s+(\S+))?\s*%}/g, (_, rawUrl, rawHeight) => {
      const url = safeUrl(rawUrl, true)
      if (!url) return stash('<span class="mdw-component-placeholder">行内图片</span>')
      const height = /^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(rawHeight || '') ? rawHeight : '24px'
      return stash(`<img class="mdw-butterfly-inline-image" src="${escapeHtml(url)}" alt="" style="height:${escapeHtml(height)}" loading="lazy">`)
    })
    text = text.replace(/{%\s*hideInline\s+(.+?)\s*%}/g, (_, raw) => {
      const [content = '隐藏内容', display = '点击查看'] = raw.split(',').map(value => value.trim())
      return stash(`<span class="mdw-butterfly-inline-hide" title="${escapeHtml(content)}">${escapeHtml(display)}</span>`)
    })
    text = text.replace(/{%\s*pdf\s+(.+?)\s*%}/g, (_, rawUrl) => {
      const url = safeUrl(rawUrl)
      const label = url ? escapeHtml(url) : 'PDF 文档'
      return stash(`<span class="mdw-component-placeholder"><i class="far fa-file-pdf" aria-hidden="true"></i> ${label}</span>`)
    })

    text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`))
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, rawUrl) => {
      const url = safeUrl(rawUrl, true)
      if (!url) return escapeHtml(alt)
      return stash(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`)
    })
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, rawUrl) => {
      const url = safeUrl(rawUrl)
      if (!url) return escapeHtml(label)
      const external = /^(?:https?:)?\/\//i.test(url)
      const attributes = external ? ' target="_blank" rel="noopener noreferrer"' : ''
      return stash(`<a href="${escapeHtml(url)}"${attributes}>${escapeHtml(label)}</a>`)
    })

    text = escapeHtml(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')

    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '')
  }

  const splitTableRow = line => line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())

  const isTableDivider = line => {
    const cells = splitTableRow(line)
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
  }

  const renderButterflyBlock = (name, argumentsText, content) => {
    const label = argumentsText.trim().split(',')[0] || {
      gallery: '图片画廊',
      hideBlock: '隐藏内容',
      hideToggle: '折叠内容',
      note: '提示块',
      score: '乐谱',
      flink: '友链'
    }[name] || name

    if (name === 'note' || name === 'subnote') {
      return `<aside class="mdw-butterfly-note"><span class="mdw-component-name">提示块</span>${renderMarkdown(content)}</aside>`
    }
    if (name === 'hideToggle' || name === 'hideBlock') {
      return `<details class="mdw-butterfly-toggle" open><summary>${renderInline(label)}</summary><div>${renderMarkdown(content)}</div></details>`
    }
    if (name === 'gallery') {
      return `<section class="mdw-butterfly-gallery"><span class="mdw-component-name">图片画廊</span>${renderMarkdown(content)}</section>`
    }
    if (/tabs$/i.test(name)) {
      const tabs = content
        .replace(/<!--\s*tab\s+(.+?)\s*-->/g, '\n### $1\n')
        .replace(/<!--\s*endtab\s*-->/g, '\n')
      return `<section class="mdw-butterfly-tabs"><span class="mdw-component-name">标签页 · ${renderInline(label)}</span>${renderMarkdown(tabs)}</section>`
    }
    if (name === 'timeline') {
      const timeline = content
        .replace(/<!--\s*timeline\s+(.+?)\s*-->/g, '\n### $1\n')
        .replace(/<!--\s*endtimeline\s*-->/g, '\n')
      return `<section class="mdw-butterfly-timeline"><span class="mdw-component-name">时间线 · ${renderInline(label)}</span>${renderMarkdown(timeline)}</section>`
    }
    return `<section class="mdw-component-placeholder"><strong>${renderInline(label)}</strong><span>此组件将在共享页面中由 Butterfly 渲染。</span></section>`
  }

  const renderMarkdown = source => {
    const lines = splitFrontMatter(normalizeMarkdownStructure(source)).body.split('\n')
    const output = []
    const headingCounts = new Map()

    const headingId = text => {
      const base = slugify(text.replace(/[*_`~]/g, ''))
      const count = headingCounts.get(base) || 0
      headingCounts.set(base, count + 1)
      return count ? `${base}-${count + 1}` : base
    }

    const startsBlock = (index) => {
      const line = lines[index] || ''
      const nextLine = lines[index + 1] || ''
      return !line.trim()
        || /^\s*(```|~~~)/.test(line)
        || /^\s*{%\s*[\w-]+\b/.test(line)
        || /^#{1,6}\s+/.test(line)
        || /^\s*(?:[-*_]\s*){3,}$/.test(line)
        || /^\s*>/.test(line)
        || /^\s*[-+*]\s+/.test(line)
        || /^\s*\d+[.)]\s+/.test(line)
        || (line.includes('|') && isTableDivider(nextLine))
    }

    for (let index = 0; index < lines.length;) {
      const line = lines[index]
      if (!line.trim()) {
        index += 1
        continue
      }

      const butterfly = line.match(/^\s*{%\s*(note|subnote|hideBlock|hideToggle|tabs|subtabs|subsubtabs|timeline|gallery|score|flink)\b(.*?)%}\s*$/i)
      if (butterfly) {
        const name = butterfly[1]
        const content = []
        const closing = new RegExp(`^\\s*{%\\s*end${name}\\s*%}\\s*$`, 'i')
        index += 1
        while (index < lines.length && !closing.test(lines[index])) {
          content.push(lines[index])
          index += 1
        }
        if (index < lines.length) index += 1
        output.push(renderButterflyBlock(name, butterfly[2], content.join('\n')))
        continue
      }

      const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)\s*$/)
      if (fence) {
        const code = []
        index += 1
        while (index < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[index])) {
          code.push(lines[index])
          index += 1
        }
        if (index < lines.length) index += 1
        const languageClass = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
        output.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`)
        continue
      }

      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (heading) {
        const level = Math.min(6, heading[1].length + 1)
        output.push(`<h${level} id="${headingId(heading[2])}">${renderInline(heading[2])}</h${level}>`)
        index += 1
        continue
      }

      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        output.push('<hr>')
        index += 1
        continue
      }

      if (/^\s*>/.test(line)) {
        const quote = []
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          quote.push(lines[index].replace(/^\s*>\s?/, ''))
          index += 1
        }
        output.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`)
        continue
      }

      const unordered = line.match(/^(\s*)[-+*]\s*(.*)$/)
      const ordered = line.match(/^(\s*)\d+[.)]\s*(.*)$/)
      if (unordered || ordered) {
        const listTag = unordered ? 'ul' : 'ol'
        const baseIndent = (unordered || ordered)[1].length
        const matcher = unordered
          ? new RegExp(`^\\s{${baseIndent}}[-+*]\\s*(.*)$`)
          : new RegExp(`^\\s{${baseIndent}}\\d+[.)]\\s*(.*)$`)
        const items = []
        while (index < lines.length) {
          const item = lines[index].match(matcher)
          if (!item) break
          const nested = []
          index += 1
          while (index < lines.length) {
            if (!lines[index].trim()) {
              let next = index + 1
              while (next < lines.length && !lines[next].trim()) next += 1
              if (next < lines.length && matcher.test(lines[next])) {
                index = next
                break
              }
              if (next < lines.length && lines[next].match(/^\s*/)[0].length > baseIndent) {
                nested.push('')
                index += 1
                continue
              }
              break
            }
            const indent = lines[index].match(/^\s*/)[0].length
            if (indent <= baseIndent) break
            nested.push(lines[index].slice(Math.min(lines[index].length, baseIndent + 2)))
            index += 1
          }

          const task = item[1].match(/^\[([ xX])\]\s+(.+)$/)
          const nestedHtml = nested.length ? renderMarkdown(nested.join('\n')) : ''
          if (task) {
            const checked = /x/i.test(task[1]) ? ' checked' : ''
            items.push(`<li class="mdw-task-item"><input type="checkbox" disabled${checked}>${renderInline(task[2])}${nestedHtml}</li>`)
          } else {
            items.push(`<li>${item[1] ? renderInline(item[1]) : ''}${nestedHtml}</li>`)
          }
        }
        output.push(`<${listTag}>${items.join('')}</${listTag}>`)
        continue
      }

      if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
        const headers = splitTableRow(line)
        const dividers = splitTableRow(lines[index + 1])
        const alignments = dividers.map(cell => cell.startsWith(':') && cell.endsWith(':')
          ? 'center'
          : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '')
        index += 2
        const rows = []
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(splitTableRow(lines[index]))
          index += 1
        }
        const style = alignment => alignment ? ` style="text-align:${alignment}"` : ''
        const head = headers.map((cell, column) => `<th${style(alignments[column])}>${renderInline(cell)}</th>`).join('')
        const body = rows.map(row => `<tr>${headers.map((_, column) => `<td${style(alignments[column])}>${renderInline(row[column] || '')}</td>`).join('')}</tr>`).join('')
        output.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
        continue
      }

      const paragraph = [line.trim()]
      index += 1
      while (index < lines.length && !startsBlock(index)) {
        paragraph.push(lines[index].trim())
        index += 1
      }
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    }

    return output.join('\n')
  }

  const renderInteractivePreview = () => {
    const blocks = splitMarkdownBlocks(elements.editor.value)
    if (!blocks.length) {
      elements.editPreview.innerHTML = '<div class="mdw-preview-empty">当前文稿还没有正文。请使用上方工具插入内容，或切换到源码模式输入。</div>'
      state.previewSelection = null
      return
    }

    elements.editPreview.innerHTML = blocks.map((block, index) => `
      <section class="mdw-preview-block" tabindex="0" role="button"
        aria-label="选择第 ${index + 1} 个内容块作为插入位置"
        data-md-start="${block.start}" data-md-end="${block.end}">
        ${renderMarkdown(block.text)}
      </section>
    `).join('')

    if (state.previewSelection) {
      const selected = Array.from(elements.editPreview.querySelectorAll('.mdw-preview-block'))
        .find(block => Number(block.dataset.mdStart) === state.previewSelection.start)
      selected?.classList.add('is-selected')
    }
  }

  const rememberSourceSelection = () => {
    state.sourceSelection = {
      start: elements.editor.selectionStart,
      end: elements.editor.selectionEnd
    }
  }

  const updateEditSurface = (focus = false) => {
    const showSource = state.editSurface === 'source'
    elements.sourcePanel.hidden = !showSource
    elements.editPreviewPanel.hidden = showSource
    elements.sourceTab.classList.toggle('is-active', showSource)
    elements.previewTab.classList.toggle('is-active', !showSource)
    elements.sourceTab.setAttribute('aria-selected', String(showSource))
    elements.previewTab.setAttribute('aria-selected', String(!showSource))

    if (showSource) {
      if (focus) {
        elements.editor.focus()
        elements.editor.setSelectionRange(state.sourceSelection.start, state.sourceSelection.end)
      }
      return
    }

    renderInteractivePreview()
    if (focus) elements.editPreview.querySelector('.is-selected, .mdw-preview-block')?.focus()
  }

  const setEditSurface = surface => {
    if (!state.editing || !['source', 'preview'].includes(surface) || state.editSurface === surface) return
    if (state.editSurface === 'source') rememberSourceSelection()
    state.editSurface = surface
    updateEditSurface(true)
  }

  const currentInsertionRange = () => {
    if (state.editSurface === 'preview') {
      const offset = state.previewSelection?.end ?? elements.editor.value.length
      return { start: offset, end: offset }
    }
    return { ...state.sourceSelection }
  }

  const replaceEditorSelection = (replacement, options = {}, range = currentInsertionRange()) => {
    const edit = applyTextEdit(elements.editor.value, range.start, range.end, replacement, options)
    elements.editor.value = edit.value
    state.sourceSelection = { start: edit.selectionStart, end: edit.selectionEnd }
    state.previewSelection = null

    if (state.editSurface === 'source') {
      elements.editor.focus()
      elements.editor.setSelectionRange(edit.selectionStart, edit.selectionEnd)
    } else {
      renderInteractivePreview()
      elements.previewSelection.textContent = '组件已插入。点击内容块可继续选择插入位置；双击可回到源码精确调整。'
    }
  }

  const applyMarkdownCommand = command => {
    const range = currentInsertionRange()
    const selected = elements.editor.value.slice(range.start, range.end)
    const lineCommand = (prefix, placeholder) => {
      const value = selected || placeholder
      const replacement = value.split('\n').map((line, index) => `${typeof prefix === 'function' ? prefix(index) : prefix}${line}`).join('\n')
      replaceEditorSelection(replacement, { block: state.editSurface === 'preview' }, range)
    }

    if (command === 'heading') return replaceEditorSelection('## {{selection}}', { block: true, placeholder: '小标题', select: '小标题' }, range)
    if (command === 'bold') return replaceEditorSelection('**{{selection}}**', { placeholder: '加粗文字', select: '加粗文字' }, range)
    if (command === 'italic') return replaceEditorSelection('*{{selection}}*', { placeholder: '斜体文字', select: '斜体文字' }, range)
    if (command === 'unordered') return lineCommand('- ', '列表项')
    if (command === 'ordered') return lineCommand(index => `${index + 1}. `, '列表项')
    if (command === 'quote') return lineCommand('> ', '引用内容')
    if (command === 'link') return replaceEditorSelection('[{{selection}}](https://example.com)', { placeholder: '链接文字', select: 'https://example.com' }, range)
    if (command === 'code') {
      const isBlock = selected.includes('\n') || state.editSurface === 'preview'
      return replaceEditorSelection(isBlock ? '```text\n{{selection}}\n```' : '`{{selection}}`', {
        block: isBlock,
        placeholder: isBlock ? '代码内容' : '行内代码',
        select: isBlock ? '代码内容' : '行内代码'
      }, range)
    }
  }

  const insertButterflyComponent = componentId => {
    const component = BUTTERFLY_COMPONENTS.find(item => item.id === componentId)
    if (!component) return
    replaceEditorSelection(component.snippet, {
      block: !component.inline || state.editSurface === 'preview',
      placeholder: component.placeholder,
      select: component.select
    })
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

  const getActiveDocument = () => state.documents.find(doc => doc.id === state.activeId) || null

  const parseRemoteTimestamp = (frontMatter, key, fallback = Date.now()) => {
    const timestamp = Date.parse(readFrontMatterValue(frontMatter, key))
    return Number.isFinite(timestamp) ? timestamp : fallback
  }

  const syncRemoteDocuments = async () => {
    if (!state.connected || !state.repository) throw new Error('请先连接 GitHub。')
    if (hasUnsavedChanges() && !window.confirm('同步会重新载入已发布文稿，是否先放弃当前未保存修改？')) return 0

    const repository = state.repository
    const baseEndpoint = repositoryEndpoint(repository)
    setConnectionStatus('正在读取远程文稿…', 'working')
    const listing = await githubRequest(`${baseEndpoint}/contents/${encodePath(repository.basePath)}?ref=${encodeURIComponent(repository.branch)}`, { allow404: true })
    const directories = Array.isArray(listing) ? listing.filter(entry => entry.type === 'dir') : []
    const remoteDocuments = []

    for (const directory of directories) {
      const remotePath = `${repository.basePath}/${directory.name}/index.md`
      const fileEndpoint = `${baseEndpoint}/contents/${encodePath(remotePath)}?ref=${encodeURIComponent(repository.branch)}`
      const file = await githubRequest(fileEndpoint, { allow404: true })
      if (!file) continue

      const content = file.content
        ? normalizeContent(decodeBase64(file.content))
        : await githubRawRequest(fileEndpoint)
      const parsed = splitFrontMatter(content)
      if (readFrontMatterValue(parsed.frontMatter, 'managed') !== 'true') continue
      const existing = state.documents.find(doc => doc.remotePath === remotePath)
      const slug = directory.name
      remoteDocuments.push({
        id: existing?.id || `remote-${slug}`,
        fileName: `${slug}.md`,
        title: deriveTitle(content, `${slug}.md`),
        content,
        createdAt: parseRemoteTimestamp(parsed.frontMatter, 'date'),
        updatedAt: parseRemoteTimestamp(parsed.frontMatter, 'updated'),
        publishedAt: Date.now(),
        publishedUrl: new URL(`/pages/${encodeURIComponent(slug)}/`, root.dataset.siteUrl || window.location.origin).href,
        remotePath,
        sha: String(file.sha || ''),
        slug,
        version: readManagedVersion(content)
      })
    }

    const localDocuments = state.documents.filter(doc => !doc.remotePath)
    state.documents = [...remoteDocuments, ...localDocuments].sort((left, right) => right.updatedAt - left.updatedAt)
    const requestedSlug = new URL(window.location.href).searchParams.get('remote')
    const requestedDocument = requestedSlug && state.documents.find(doc => doc.slug === requestedSlug)
    if (requestedDocument) state.activeId = requestedDocument.id
    else if (!state.documents.some(doc => doc.id === state.activeId)) state.activeId = state.documents[0]?.id || null
    state.editing = false
    state.editSurface = 'source'
    state.previewSelection = null
    state.originalContent = ''
    persistDocuments()
    render()
    setConnectionStatus(`已连接 ${repository.owner}/${repository.repo}，同步 ${remoteDocuments.length} 个共享页面。`, 'success')
    return remoteDocuments.length
  }

  const connectGithub = async () => {
    const repository = validateRepository(repositoryFromFields())
    const suppliedToken = elements.token.value.trim()
    githubToken = suppliedToken
    if (!githubToken) throw new Error('请输入 fine-grained personal access token。')

    elements.connectButton.disabled = true
    setConnectionStatus('正在验证仓库权限…', 'working')
    try {
      const information = await githubRequest(repositoryEndpoint(repository))
      if (information.permissions && information.permissions.push === false) throw new Error('当前令牌没有该仓库的写入权限。')
      state.repository = repository
      state.connected = true
      localStorage.setItem(REPOSITORY_KEY, JSON.stringify(repository))
      elements.token.value = ''
      render()
      const count = await syncRemoteDocuments()
      announce(`GitHub 已连接，共同步 ${count} 个共享页面。`)
    } catch (error) {
      state.connected = false
      state.repository = null
      githubToken = ''
      setConnectionStatus(`连接失败：${error.message}`, 'error')
      throw error
    } finally {
      elements.connectButton.disabled = false
      render()
    }
  }

  const disconnectGithub = () => {
    deploymentRun += 1
    githubToken = ''
    state.connected = false
    state.repository = null
    setConnectionStatus('已断开连接；本地草稿和已同步副本仍保留在当前浏览器。')
    render()
  }

  const showDeployment = (message, document) => {
    elements.deployment.hidden = false
    elements.deploymentMessage.textContent = message
    elements.liveLink.hidden = true
    elements.actionsLink.hidden = true
    if (document?.publishedUrl) {
      elements.liveLink.href = document.publishedUrl
      elements.liveLink.hidden = false
    }
    if (state.repository) {
      elements.actionsLink.href = `https://github.com/${encodeURIComponent(state.repository.owner)}/${encodeURIComponent(state.repository.repo)}/actions`
      elements.actionsLink.hidden = false
    }
  }

  const watchDeployment = document => {
    const currentRun = ++deploymentRun
    const deadline = Date.now() + 10 * 60 * 1000

    const check = async () => {
      if (currentRun !== deploymentRun) return
      try {
        const response = await fetch(`${document.publishedUrl}?managed-version=${encodeURIComponent(document.version)}&t=${Date.now()}`, { cache: 'no-store' })
        const html = response.ok ? await response.text() : ''
        if (html.includes(`data-version="${document.version}"`)) {
          showDeployment('部署完成，所有访客现在都可以看到最新内容。', document)
          return
        }
      } catch {
        // 部署期间的临时网络错误会在下次轮询时重试。
      }

      if (Date.now() >= deadline) {
        showDeployment('提交已完成，但十分钟内未检测到新版本。请打开构建进度确认部署状态。', document)
        return
      }
      setTimeout(check, 8000)
    }

    showDeployment('已提交到 GitHub，正在等待构建和部署；当前本地预览已经更新。', document)
    setTimeout(check, 4000)
  }

  const publishActiveDocument = async () => {
    if (!state.connected || !state.repository) {
      announce('请先连接具有 Contents 写入权限的 GitHub 仓库。', 'error')
      return
    }

    let document = getActiveDocument()
    if (!document) return
    if (state.editing) document = saveAndExit({ silent: true })
    if (!document) return

    state.publishing = true
    render()
    showDeployment('正在准备 Markdown 页面…', document)
    try {
      const prepared = prepareManagedDocument(document.content, {
        basePath: state.repository.basePath,
        fileName: document.fileName,
        slug: document.slug || document.fileName.replace(/\.md$/i, '')
      })
      const baseEndpoint = repositoryEndpoint(state.repository)
      const contentEndpoint = `${baseEndpoint}/contents/${encodePath(prepared.remotePath)}`
      const current = await githubRequest(`${contentEndpoint}?ref=${encodeURIComponent(state.repository.branch)}`, { allow404: true })

      if (current && !document.remotePath) {
        throw new Error(`共享页面 “${prepared.slug}” 已存在。请先重新同步并选择该页面后再编辑。`)
      }
      if (current && document.sha && current.sha !== document.sha) {
        throw new Error('远程文稿在本次编辑期间发生了变化。请重新同步后合并修改。')
      }

      const result = await githubRequest(contentEndpoint, {
        method: 'PUT',
        body: {
          message: `${current ? 'docs: update' : 'docs: publish'} page ${prepared.slug}`,
          content: encodeBase64(prepared.content),
          branch: state.repository.branch,
          ...(current?.sha ? { sha: current.sha } : {})
        }
      })

      document.content = prepared.content
      document.title = prepared.title
      document.fileName = `${prepared.slug}.md`
      document.slug = prepared.slug
      document.remotePath = prepared.remotePath
      document.sha = String(result?.content?.sha || '')
      document.version = prepared.version
      document.updatedAt = Date.now()
      document.publishedAt = Date.now()
      document.publishedUrl = new URL(prepared.pagePath, root.dataset.siteUrl || window.location.origin).href
      persistDocuments()
      render()
      announce('文稿已提交，正在等待 GitHub Pages 部署。')
      watchDeployment(document)
    } catch (error) {
      console.error('发布 Markdown 页面失败。', error)
      showDeployment(`发布失败：${error.message}`, document)
      announce(`发布失败：${error.message}`, 'error')
    } finally {
      state.publishing = false
      render()
    }
  }

  const updatePageUrl = (id, method = 'pushState') => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('doc', id)
    else url.searchParams.delete('doc')
    history[method]({}, '', url)
  }

  const hasUnsavedChanges = () => state.editing && elements.editor.value !== state.originalContent

  const confirmDiscard = () => !hasUnsavedChanges() || window.confirm('当前修改尚未保存，确定要放弃吗？')

  const renderDocumentList = () => {
    elements.documentList.replaceChildren()
    elements.documentCount.textContent = String(state.documents.length)
    elements.libraryEmpty.hidden = state.documents.length > 0

    state.documents.forEach(doc => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `mdw-document-item${doc.id === state.activeId ? ' is-active' : ''}`
      button.dataset.documentId = doc.id
      button.setAttribute('aria-current', doc.id === state.activeId ? 'page' : 'false')

      const title = document.createElement('strong')
      title.textContent = doc.title
      const meta = document.createElement('span')
      meta.textContent = `${formatDate(doc.updatedAt)} · ${doc.remotePath ? '已发布' : '本地草稿'}`
      button.append(title, meta)
      button.addEventListener('click', () => selectDocument(doc.id))
      elements.documentList.append(button)
    })
  }

  const renderActiveDocument = () => {
    const doc = getActiveDocument()
    const hasDocument = Boolean(doc)
    elements.emptyState.hidden = hasDocument
    elements.viewMode.hidden = !hasDocument || state.editing
    elements.editMode.hidden = !hasDocument || !state.editing

    if (!doc) {
      document.title = BASE_DOCUMENT_TITLE
      return
    }

    document.title = `${doc.title} | Markdown 工作台`
    elements.documentTitle.textContent = doc.title
    elements.documentMeta.textContent = `${doc.fileName} · 更新于 ${formatDate(doc.updatedAt)} · ${doc.remotePath ? '已发布' : '本地草稿'}`
    if (!state.editing) {
      elements.preview.innerHTML = renderMarkdown(stripManagedDocumentChrome(doc.content))
    } else {
      updateEditSurface()
    }
  }

  const render = () => {
    renderDocumentList()
    renderActiveDocument()
    updateConnectionUi()
  }

  const selectDocument = (id, options = {}) => {
    if (!state.documents.some(doc => doc.id === id)) return
    if (id !== state.activeId && !confirmDiscard()) return

    state.activeId = id
    state.editing = false
    state.editSurface = 'source'
    state.previewSelection = null
    state.originalContent = ''
    updatePageUrl(id, options.replace ? 'replaceState' : 'pushState')
    render()
  }

  const enterEditMode = () => {
    const doc = getActiveDocument()
    if (!doc) return
    const editableContent = normalizeMarkdownStructure(stripManagedDocumentChrome(doc.content))
    state.editing = true
    state.editSurface = 'source'
    state.previewSelection = null
    state.originalContent = editableContent
    elements.editor.value = editableContent
    state.sourceSelection = { start: editableContent.length, end: editableContent.length }
    render()
    elements.editor.focus()
    elements.editor.setSelectionRange(editableContent.length, editableContent.length)
  }

  const applyEditorContent = () => {
    const doc = getActiveDocument()
    if (!doc) return null

    const content = normalizeMarkdownStructure(elements.editor.value)
    elements.editor.value = content
    doc.content = content
    doc.title = deriveTitle(content, doc.fileName)
    doc.updatedAt = Date.now()
    state.documents.sort((left, right) => right.updatedAt - left.updatedAt)
    return doc
  }

  const saveAndExit = (options = {}) => {
    const doc = applyEditorContent()
    if (!doc) return null

    try {
      persistDocuments()
      state.editing = false
      state.editSurface = 'source'
      state.previewSelection = null
      state.originalContent = ''
      render()
      if (!options.silent) announce('草稿已保存，当前浏览器中的预览已更新。')
      return doc
    } catch (error) {
      console.error('保存 Markdown 文稿失败。', error)
      announce('保存失败：浏览器本地存储空间可能不足。', 'error')
      return null
    }
  }

  const cancelEdit = () => {
    if (!confirmDiscard()) return
    state.editing = false
    state.editSurface = 'source'
    state.previewSelection = null
    state.originalContent = ''
    render()
  }

  const importFiles = async fileList => {
    const files = Array.from(fileList || [])
    if (!files.length) return

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
        imported.push({
          id: createId(file.name),
          fileName: file.name,
          title: deriveTitle(content, file.name),
          content,
          createdAt: now,
          updatedAt: now
        })
      } catch (error) {
        console.error(`读取 ${file.name} 失败。`, error)
        rejected.push(`${file.name}（读取失败）`)
      }
    }

    if (imported.length) {
      const previousDocuments = state.documents.slice()
      state.documents = [...imported, ...state.documents]
      try {
        persistDocuments()
        state.activeId = imported[0].id
        state.editing = false
        updatePageUrl(state.activeId)
        render()
        announce(`已导入 ${imported.length} 份 Markdown 文稿。${rejected.length ? ` ${rejected.length} 份未导入。` : ''}`)
      } catch (error) {
        state.documents = previousDocuments
        console.error('导入 Markdown 文稿失败。', error)
        announce('导入失败：浏览器本地存储空间可能不足。', 'error')
      }
    } else if (rejected.length) {
      announce(`未导入文件：${rejected.join('、')}`, 'error')
    }
    elements.fileInput.value = ''
  }

  const downloadActiveDocument = () => {
    const doc = getActiveDocument()
    if (!doc) return

    const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = doc.fileName.endsWith('.md') ? doc.fileName : `${doc.fileName}.md`
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  elements.fileInput.addEventListener('change', event => importFiles(event.target.files))
  elements.editButton.addEventListener('click', enterEditMode)
  elements.saveButton.addEventListener('click', () => saveAndExit())
  elements.cancelButton.addEventListener('click', cancelEdit)
  elements.downloadButton.addEventListener('click', downloadActiveDocument)
  elements.publishButton.addEventListener('click', publishActiveDocument)
  elements.publishEditButton.addEventListener('click', publishActiveDocument)
  elements.connectButton.addEventListener('click', () => {
    connectGithub().catch(error => announce(`GitHub 连接失败：${error.message}`, 'error'))
  })
  elements.syncButton.addEventListener('click', () => {
    syncRemoteDocuments()
      .then(count => announce(`已重新同步 ${count} 个共享页面。`))
      .catch(error => announce(`同步失败：${error.message}`, 'error'))
  })
  elements.disconnectButton.addEventListener('click', disconnectGithub)
  elements.sourceTab.addEventListener('click', () => {
    if (state.editSurface === 'source') elements.editor.focus()
    else setEditSurface('source')
  })
  elements.previewTab.addEventListener('click', () => {
    if (state.editSurface === 'preview') renderInteractivePreview()
    else setEditSurface('preview')
  })
  root.addEventListener('click', event => {
    const markdownButton = event.target.closest('[data-md-command]')
    if (markdownButton) applyMarkdownCommand(markdownButton.dataset.mdCommand)
    const componentButton = event.target.closest('[data-component]')
    if (componentButton) insertButterflyComponent(componentButton.dataset.component)
  })
  const selectPreviewBlock = block => {
    if (!block) return
    elements.editPreview.querySelectorAll('.mdw-preview-block.is-selected').forEach(item => item.classList.remove('is-selected'))
    block.classList.add('is-selected')
    state.previewSelection = {
      start: Number(block.dataset.mdStart),
      end: Number(block.dataset.mdEnd)
    }
    elements.previewSelection.textContent = '已选择此内容块；使用上方工具会插入到它后面。双击可在源码中精确编辑。'
  }
  elements.editPreview.addEventListener('click', event => selectPreviewBlock(event.target.closest('.mdw-preview-block')))
  elements.editPreview.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    selectPreviewBlock(event.target.closest('.mdw-preview-block'))
  })
  elements.editPreview.addEventListener('dblclick', event => {
    const block = event.target.closest('.mdw-preview-block')
    if (!block) return
    state.sourceSelection = {
      start: Number(block.dataset.mdStart),
      end: Number(block.dataset.mdEnd)
    }
    state.editSurface = 'source'
    updateEditSurface(true)
  })
  ;['select', 'keyup', 'click', 'input'].forEach(eventName => {
    elements.editor.addEventListener(eventName, rememberSourceSelection)
  })
  elements.editor.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      saveAndExit()
    }
  })
  window.addEventListener('popstate', () => {
    if (!confirmDiscard()) {
      updatePageUrl(state.activeId, 'replaceState')
      return
    }
    const requestedId = new URL(window.location.href).searchParams.get('doc')
    state.activeId = state.documents.some(doc => doc.id === requestedId) ? requestedId : null
    state.editing = false
    state.editSurface = 'source'
    state.previewSelection = null
    render()
  })
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  })

  state.documents = loadDocuments()
  renderComponentTools()
  const repositorySettings = loadRepositorySettings()
  elements.owner.value = repositorySettings.owner
  elements.repo.value = repositorySettings.repo
  elements.branch.value = repositorySettings.branch
  const requestedId = new URL(window.location.href).searchParams.get('doc')
  state.activeId = state.documents.some(doc => doc.id === requestedId)
    ? requestedId
    : state.documents[0]?.id || null
  updatePageUrl(state.activeId, 'replaceState')
  render()

})()
