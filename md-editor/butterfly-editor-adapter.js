(function (root, factory) {
  'use strict'

  const api = factory(root?.MarkdownEditorCore)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ButterflyEditorAdapter = api
})(typeof globalThis === 'undefined' ? this : globalThis, core => {
  'use strict'

  const normalize = value => String(value || '').replace(/\r\n?/g, '\n')
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pairedTags = ['note', 'subnote', 'hideBlock', 'hideToggle', 'tabs', 'subtabs', 'subsubtabs', 'timeline', 'gallery', 'score', 'flink', 'mermaid']
  const inlineTags = ['label', 'btn', 'button', 'hideInline', 'inlineImg', 'galleryGroup', 'pdf', 'series']
  const colors = ['default', 'blue', 'pink', 'red', 'orange', 'purple', 'green']
  const noteTypes = ['default', 'primary', 'info', 'success', 'warning', 'danger']
  const noteStyles = ['simple', 'modern', 'flat', 'disabled']
  const colorOptions = colors.map(value => ({ label: value, value }))
  const noteTypeOptions = noteTypes.map(value => ({ label: value, value }))
  const noteStyleOptions = noteStyles.map(value => ({ label: value, value }))
  const PLACEHOLDER_PATTERN_SOURCE = '\\[\\[BUTTERFLY_COMPONENT_[a-z0-9-]+\\]\\]'

  const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra })
  const textarea = (key, label, extra = {}) => ({ key, label, type: 'textarea', ...extra })
  const asset = (key, label, extra = {}) => ({ key, label, type: 'asset', ...extra })
  const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra })
  const checkbox = (key, label, extra = {}) => ({ key, label, type: 'checkbox', ...extra })
  const color = (key, label, extra = {}) => ({ key, label, type: 'color', ...extra })
  const number = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra })
  const repeater = (key, label, fields, extra = {}) => ({ key, label, type: 'repeater', fields, ...extra })

  const schemas = Object.freeze({
    note: {
      label: '提示块',
      defaults: { kind: 'info', style: 'modern', icon: '', extraClass: '', body: '在这里填写提示内容' },
      fields: [
        select('kind', '类型', noteTypeOptions),
        select('style', '样式', noteStyleOptions),
        text('icon', 'Font Awesome 图标类', { placeholder: 'fa-info-circle' }),
        text('extraClass', '额外样式类', { placeholder: '可选' }),
        textarea('body', '内容', { required: true, markdown: true })
      ]
    },
    subnote: {
      label: '子提示块',
      defaults: { kind: 'info', style: 'flat', icon: '', extraClass: '', body: '子提示内容' },
      fields: []
    },
    label: {
      label: '彩色标签',
      defaults: { content: '标签文字', color: 'blue' },
      fields: [text('content', '标签文字', { required: true }), select('color', '颜色', colorOptions)]
    },
    btn: {
      label: '链接按钮',
      defaults: { url: 'https://example.com', content: '按钮文字', icon: 'fas fa-link', color: 'blue', outline: false, center: false, block: false, larger: false },
      fields: [
        text('url', '链接', { required: true, inputMode: 'url', placeholder: 'https://example.com' }),
        text('content', '按钮文字'),
        text('icon', 'Font Awesome 图标', { placeholder: 'fas fa-link' }),
        select('color', '颜色', colorOptions),
        checkbox('outline', '描边'), checkbox('center', '居中'), checkbox('block', '块级宽度'), checkbox('larger', '大号')
      ]
    },
    hideInline: {
      label: '隐藏文字',
      defaults: { content: '隐藏文字', display: '点击查看', background: '#49b1f5', color: '#ffffff' },
      fields: [text('content', '隐藏内容', { required: true }), text('display', '按钮文字'), color('background', '背景色'), color('color', '文字色')]
    },
    hideBlock: {
      label: '隐藏区块',
      defaults: { display: '点击查看', background: '#49b1f5', color: '#ffffff', body: '隐藏内容' },
      fields: [text('display', '按钮文字'), color('background', '背景色'), color('color', '文字色'), textarea('body', '隐藏内容', { required: true, markdown: true })]
    },
    hideToggle: {
      label: '折叠内容',
      defaults: { display: '点击展开', background: '#49b1f5', color: '#ffffff', body: '隐藏内容' },
      fields: []
    },
    tabs: {
      label: '标签页',
      defaults: { name: '示例标签页', active: 1, items: [{ title: '标签一', icon: '', body: '标签一内容' }, { title: '标签二', icon: '', body: '标签二内容' }] },
      fields: [
        text('name', '唯一名称', { required: true }), number('active', '默认选中页', { min: 0, step: 1 }),
        repeater('items', '页签', [text('title', '标题'), text('icon', '图标', { placeholder: 'fas fa-star' }), textarea('body', '内容', { required: true, markdown: true })], { addLabel: '添加页签', minItems: 1 })
      ]
    },
    subtabs: { label: '二级标签页', defaults: {}, fields: [] },
    subsubtabs: { label: '三级标签页', defaults: {}, fields: [] },
    timeline: {
      label: '时间线',
      defaults: { headline: '时间线', color: 'blue', items: [{ title: '阶段一', body: '阶段内容' }] },
      fields: [text('headline', '标题'), select('color', '颜色', colorOptions), repeater('items', '节点', [text('title', '节点标题', { required: true }), textarea('body', '节点内容', { required: true, markdown: true })], { addLabel: '添加节点', minItems: 1 })]
    },
    gallery: {
      label: '图片画廊',
      defaults: { mode: 'images', dataUrl: '', button: false, items: [{ alt: '图片说明', source: '/img/example.webp', title: '' }] },
      fields: [
        select('mode', '数据模式', [{ label: '图片列表', value: 'images' }, { label: '远程 JSON', value: 'url' }]),
        text('dataUrl', '远程 JSON 地址', { inputMode: 'url', placeholder: 'https://example.com/gallery.json' }), checkbox('button', '显示加载更多按钮'),
        repeater('items', '图片', [text('alt', '替代文字'), asset('source', '图片', { required: true, accept: 'image' }), text('title', '图片标题')], { addLabel: '添加图片', minItems: 1 })
      ]
    },
    galleryGroup: {
      label: '画廊分组',
      defaults: { name: '相册', description: '相册说明', url: '/photos/', image: '/img/example.webp' },
      fields: [text('name', '分组名称', { required: true }), text('description', '分组说明'), text('url', '目标链接', { required: true }), asset('image', '封面图', { required: true, accept: 'image' })]
    },
    inlineImg: {
      label: '行内图片',
      defaults: { source: '/img/example.webp', height: '24px' },
      fields: [asset('source', '图片', { required: true, accept: 'image' }), text('height', '高度', { placeholder: '24px' })]
    },
    pdf: {
      label: 'PDF',
      defaults: { source: '/pdf/example.pdf' },
      fields: [asset('source', 'PDF 文件或地址', { required: true, accept: 'pdf' })]
    },
    flink: {
      label: '友链卡片',
      defaults: { groups: [{ name: '友情链接', description: '值得访问的站点', links: [{ name: '示例', url: 'https://example.com', avatar: '/img/avatar.webp', description: '站点说明', color: '#49b1f5' }] }] },
      fields: [repeater('groups', '分组', [
        text('name', '分组名称', { required: true }), text('description', '分组说明'),
        repeater('links', '链接', [text('name', '站点名称', { required: true }), text('url', '站点链接', { required: true }), asset('avatar', '头像', { required: true, accept: 'image' }), text('description', '站点说明'), color('color', '卡片颜色')], { addLabel: '添加链接', minItems: 1 })
      ], { addLabel: '添加分组', minItems: 1 })]
    },
    mermaid: {
      label: 'Mermaid 图表',
      defaults: { template: 'flowchart', source: 'graph TD\n  A[开始] --> B[结束]' },
      fields: [select('template', '模板', [{ label: '流程图', value: 'flowchart' }, { label: '时序图', value: 'sequence' }, { label: '甘特图', value: 'gantt' }]), textarea('source', 'Mermaid 源码', { required: true, code: true })]
    },
    score: {
      label: 'ABC 乐谱',
      defaults: { source: 'X:1\nT:示例\nM:4/4\nK:C\nC D E F|G A B c|' },
      fields: [textarea('source', 'ABC 乐谱源码', { required: true, code: true })]
    }
  })

  schemas.subnote.fields = schemas.note.fields
  schemas.hideToggle.fields = schemas.hideBlock.fields
  schemas.subtabs.defaults = schemas.tabs.defaults
  schemas.subtabs.fields = schemas.tabs.fields
  schemas.subsubtabs.defaults = schemas.tabs.defaults
  schemas.subsubtabs.fields = schemas.tabs.fields

  const clone = value => JSON.parse(JSON.stringify(value))
  const getSchema = name => schemas[name === 'button' ? 'btn' : name] || null
  const defaultsFor = name => clone(getSchema(name)?.defaults || {})
  const splitWords = value => String(value || '').trim().split(/\s+/).filter(Boolean)
  const decodeToken = value => String(value || '').replace(/&nbsp;/gi, ' ').replace(/&#(?:44|x2c);/gi, ',')
  const splitComma = value => String(value || '').split(',').map(item => decodeToken(item.trim()))
  const encodeToken = value => String(value || '').trim().replace(/\s+/g, '&nbsp;').replace(/,/g, '&#44;')
  const quoteYaml = value => JSON.stringify(String(value || ''))

  const parseTabs = body => {
    const items = []
    const expression = /<!--\s*tab\s*(.*?)\s*-->\n([\s\S]*?)<!--\s*endtab\s*-->/gi
    for (const match of normalize(body).matchAll(expression)) {
      const [title = '', icon = ''] = match[1].split('@')
      items.push({ title: title.trim(), icon: icon.trim(), body: match[2].replace(/^\n|\n$/g, '') })
    }
    return items
  }

  const parseTimeline = body => {
    const items = []
    const expression = /<!--\s*timeline\s*(.*?)\s*-->\n([\s\S]*?)<!--\s*endtimeline\s*-->/gi
    for (const match of normalize(body).matchAll(expression)) items.push({ title: match[1].trim(), body: match[2].replace(/^\n|\n$/g, '') })
    return items
  }

  const parseGalleryImages = body => {
    const items = []
    const expression = /!\[(.*?)\]\(([^\s)]+)\s*(?:["'](.*?)["'])?\)/g
    for (const match of normalize(body).matchAll(expression)) items.push({ alt: match[1], source: match[2], title: match[3] || '' })
    return items
  }

  const parseFlink = body => {
    const groups = []
    let group = null
    let link = null
    normalize(body).split('\n').forEach(line => {
      let match = line.match(/^\s*-\s+class_name:\s*(.*)$/)
      if (match) {
        group = { name: parseYamlScalar(match[1]), description: '', links: [] }
        groups.push(group)
        link = null
        return
      }
      match = line.match(/^\s+class_desc:\s*(.*)$/)
      if (match && group) { group.description = parseYamlScalar(match[1]); return }
      match = line.match(/^\s+-\s+name:\s*(.*)$/)
      if (match && group) {
        link = { name: parseYamlScalar(match[1]), url: '', avatar: '', description: '', color: '#383838' }
        group.links.push(link)
        return
      }
      match = line.match(/^\s+(link|avatar|descr|theme_color):\s*(.*)$/)
      if (match && link) {
        const key = { link: 'url', avatar: 'avatar', descr: 'description', theme_color: 'color' }[match[1]]
        link[key] = parseYamlScalar(match[2])
      }
    })
    return groups
  }

  const parseYamlScalar = value => {
    const source = String(value || '').trim()
    if (!source) return ''
    try { return JSON.parse(source) } catch { return source.replace(/^['"]|['"]$/g, '') }
  }

  const valuesFromEntry = entry => {
    const name = entry.name === 'button' ? 'btn' : entry.name
    const defaults = defaultsFor(name)
    const args = entry.args || ''
    const body = entry.body || ''

    if (name === 'note' || name === 'subnote') {
      const words = splitWords(args)
      const style = words.find(word => noteStyles.includes(word)) || defaults.style
      const kind = words.find(word => noteTypes.includes(word)) || defaults.kind
      const iconIndex = words.length > 1 && /^fa/.test(words[words.length - 2]) ? words.length - 2 : -1
      const icon = iconIndex >= 0 ? words[iconIndex] : ''
      const extras = words.filter((word, index) => word !== style && word !== kind && index !== iconIndex && !/^fa[srlbd]?$/.test(word))
      return { ...defaults, kind, style, icon, extraClass: extras.join(' '), body }
    }
    if (name === 'label') {
      const words = splitWords(args)
      return { ...defaults, content: decodeToken(words[0] || defaults.content), color: words[1] || defaults.color }
    }
    if (name === 'btn') {
      const [url, content, icon, options = ''] = splitComma(args)
      const optionWords = splitWords(options)
      return { ...defaults, url, content, icon, color: optionWords.find(word => colors.includes(word)) || 'default', outline: optionWords.includes('outline'), center: optionWords.includes('center'), block: optionWords.includes('block'), larger: optionWords.includes('larger') }
    }
    if (name === 'hideInline') {
      const [content, display, background, foreground] = splitComma(args)
      return { ...defaults, content, display, background, color: foreground }
    }
    if (name === 'hideBlock' || name === 'hideToggle') {
      const [display, background, foreground] = splitComma(args)
      return { ...defaults, display, background, color: foreground, body }
    }
    if (['tabs', 'subtabs', 'subsubtabs'].includes(name)) {
      const [tabName, active] = splitComma(args)
      const items = parseTabs(body)
      return { ...defaults, name: tabName || defaults.name, active: Number(active) || 0, items: items.length ? items : clone(defaults.items) }
    }
    if (name === 'timeline') {
      const [headline, timelineColor] = splitComma(args)
      const items = parseTimeline(body)
      return { ...defaults, headline, color: timelineColor || 'default', items: items.length ? items : clone(defaults.items) }
    }
    if (name === 'gallery') {
      const parts = splitComma(args)
      if (parts[0] === 'url') return { ...defaults, mode: 'url', dataUrl: parts[1] || '', button: parts[2] === 'true', items: [] }
      const items = parseGalleryImages(body)
      return { ...defaults, mode: 'images', button: parts[0] === 'true', items: items.length ? items : clone(defaults.items) }
    }
    if (name === 'galleryGroup') {
      const words = splitWords(args).map(decodeToken)
      return { ...defaults, name: words[0], description: words[1], url: words[2], image: words[3] }
    }
    if (name === 'inlineImg') {
      const [source, height] = splitWords(args)
      return { ...defaults, source, height }
    }
    if (name === 'pdf') return { ...defaults, source: args }
    if (name === 'flink') {
      const groups = parseFlink(body)
      return { ...defaults, groups: groups.length ? groups : clone(defaults.groups) }
    }
    if (name === 'mermaid') return { ...defaults, source: body }
    if (name === 'score') return { ...defaults, source: body }
    return { args, body }
  }

  const serializeValues = (nameValue, values) => {
    const name = nameValue === 'button' ? 'btn' : nameValue
    if (name === 'note' || name === 'subnote') {
      const icon = splitWords(values.icon).filter(word => /^fa-/.test(word)).pop() || ''
      return { args: [values.kind, values.extraClass, icon, values.style].filter(Boolean).join(' '), body: values.body, paired: true }
    }
    if (name === 'label') return { args: `${encodeToken(values.content)} ${values.color || 'default'}`, body: '', paired: false }
    if (name === 'btn') {
      const options = [values.color, values.outline && 'outline', values.center && 'center', values.block && 'block', values.larger && 'larger'].filter(Boolean).join(' ')
      return { args: [values.url, values.content, values.icon, options].map(item => String(item || '').replace(/,/g, '&#44;')).join(','), body: '', paired: false }
    }
    if (name === 'hideInline') return { args: [values.content, values.display, values.background, values.color].map(item => String(item || '').replace(/,/g, '&#44;')).join(','), body: '', paired: false }
    if (name === 'hideBlock' || name === 'hideToggle') return { args: [values.display, values.background, values.color].map(item => String(item || '').replace(/,/g, '&#44;')).join(','), body: values.body, paired: true }
    if (['tabs', 'subtabs', 'subsubtabs'].includes(name)) {
      const body = (values.items || []).map(item => `<!-- tab ${String(item.title || '').trim()}${item.icon ? `@${String(item.icon).trim()}` : ''} -->\n${String(item.body || '').replace(/^\n|\n$/g, '')}\n<!-- endtab -->`).join('\n')
      return { args: `${String(values.name || '').replace(/,/g, '&#44;')},${Number(values.active) || 0}`, body, paired: true }
    }
    if (name === 'timeline') {
      const body = (values.items || []).map(item => `<!-- timeline ${String(item.title || '').trim()} -->\n${String(item.body || '').replace(/^\n|\n$/g, '')}\n<!-- endtimeline -->`).join('\n')
      return { args: `${String(values.headline || '').replace(/,/g, '&#44;')},${values.color || 'default'}`, body, paired: true }
    }
    if (name === 'gallery') {
      if (values.mode === 'url') return { args: `url,${values.dataUrl || ''},${Boolean(values.button)}`, body: '', paired: true }
      const body = (values.items || []).map(item => `![${String(item.alt || '').replace(/]/g, '\\]')}](${item.source || ''}${item.title ? ` "${String(item.title).replace(/"/g, '&quot;')}"` : ''})`).join('\n')
      return { args: String(Boolean(values.button)), body, paired: true }
    }
    if (name === 'galleryGroup') return { args: [values.name, values.description, values.url, values.image].map(encodeToken).join(' '), body: '', paired: false }
    if (name === 'inlineImg') return { args: [values.source, values.height].filter(Boolean).join(' '), body: '', paired: false }
    if (name === 'pdf') return { args: String(values.source || '').trim(), body: '', paired: false }
    if (name === 'flink') {
      const lines = []
      ;(values.groups || []).forEach(group => {
        lines.push(`- class_name: ${quoteYaml(group.name)}`, `  class_desc: ${quoteYaml(group.description)}`, '  link_list:')
        ;(group.links || []).forEach(link => lines.push(`    - name: ${quoteYaml(link.name)}`, `      link: ${quoteYaml(link.url)}`, `      avatar: ${quoteYaml(link.avatar)}`, `      descr: ${quoteYaml(link.description)}`, `      theme_color: ${quoteYaml(link.color || '#383838')}`))
      })
      return { args: '', body: lines.join('\n'), paired: true }
    }
    if (name === 'mermaid' || name === 'score') return { args: '', body: values.source || '', paired: true }
    return { args: values.args || '', body: values.body || '', paired: Boolean(values.body) }
  }

  const parseRaw = rawValue => {
    const raw = normalize(rawValue).trim()
    const opening = raw.match(/^{%\s*([\w-]+)\b([^%]*?)%}/i)
    if (!opening) return null
    const originalName = opening[1]
    const name = originalName === 'button' ? 'btn' : originalName
    const closing = new RegExp(`{%\\s*end${escapeRegExp(originalName)}\\s*%}\\s*$`, 'i')
    const paired = closing.test(raw)
    const body = paired ? raw.slice(opening[0].length).replace(closing, '').replace(/^\n|\n$/g, '') : ''
    const entry = { args: opening[2].trim(), body, label: getSchema(name)?.label || name, name, paired, raw }
    entry.values = valuesFromEntry(entry)
    return entry
  }

  const applyValues = (entry, values) => {
    const serialized = serializeValues(entry.name, values)
    entry.name = entry.name === 'button' ? 'btn' : entry.name
    entry.args = serialized.args
    entry.body = normalize(serialized.body).replace(/^\n|\n$/g, '')
    entry.paired = serialized.paired
    entry.values = clone(values)
    entry.label = getSchema(entry.name)?.label || entry.label
    return entry
  }

  const serializeEntry = entry => {
    const opening = `{% ${entry.name}${entry.args ? ` ${entry.args.trim()}` : ''} %}`
    return entry.paired ? `${opening}\n${String(entry.body || '').replace(/^\n|\n$/g, '')}\n{% end${entry.name} %}` : opening
  }

  const protectMarkdown = source => {
    let markdown = normalize(source)
    const entries = []
    let counter = 0
    const replaceRaw = raw => {
      const parsed = parseRaw(raw)
      if (!parsed) return raw
      counter += 1
      const seed = core?.contentHash ? core.contentHash(`${counter}:${raw}`).replace(/[^a-z0-9-]/gi, '') : `${Date.now().toString(36)}${counter}`
      const id = `${seed}-${counter}`.toLowerCase()
      const placeholder = `[[BUTTERFLY_COMPONENT_${id}]]`
      entries.push({ ...parsed, id, placeholder })
      return placeholder
    }
    pairedTags.forEach(name => {
      const expression = new RegExp(`{%\\s*${escapeRegExp(name)}\\b[^%]*?%}[\\s\\S]*?{%\\s*end${escapeRegExp(name)}\\s*%}`, 'gi')
      markdown = markdown.replace(expression, replaceRaw)
    })
    const inlineExpression = new RegExp(`{%\\s*(?:${inlineTags.map(escapeRegExp).join('|')})\\b[^%]*?%}`, 'gi')
    markdown = markdown.replace(inlineExpression, replaceRaw)
    return { entries, markdown }
  }

  const restoreMarkdown = (source, entries = []) => {
    let markdown = normalize(source)
    entries.forEach(entry => {
      const raw = serializeEntry(entry)
      const escaped = entry.placeholder.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
      markdown = markdown
        .replace(new RegExp(`(?:\\$\\$widget\\d+\\s+)?${escapeRegExp(entry.placeholder)}(?:\\$\\$)?`, 'g'), raw)
        .replace(new RegExp(`(?:\\$\\$widget\\d+\\s+)?${escapeRegExp(escaped)}(?:\\$\\$)?`, 'g'), raw)
    })
    return markdown
  }

  const entryFromComponent = component => {
    const selection = component.select || component.placeholder || ''
    const parsed = parseRaw(String(component.snippet || '').replace('{{selection}}', selection))
    if (!parsed) return null
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return { ...parsed, id, placeholder: `[[BUTTERFLY_COMPONENT_${id}]]` }
  }

  const validateValues = (name, values) => {
    const schema = getSchema(name)
    const errors = []
    const visit = (fields, current, prefix = '') => fields.forEach(field => {
      if (name === 'gallery' && field.key === 'dataUrl' && values.mode !== 'url') return
      if (name === 'gallery' && field.key === 'items' && values.mode === 'url') return
      const value = current?.[field.key]
      const label = `${prefix}${field.label}`
      if (field.required && !String(value || '').trim()) errors.push(`${label}不能为空`)
      if (field.type === 'repeater') {
        const items = Array.isArray(value) ? value : []
        if (field.minItems && items.length < field.minItems) errors.push(`${label}至少需要 ${field.minItems} 项`)
        items.forEach((item, index) => visit(field.fields, item, `${label} ${index + 1}：`))
      }
      if ((field.inputMode === 'url' || field.type === 'asset') && value && !/^(?:https?:\/\/|\/|mdw-asset:\/\/)/i.test(String(value))) errors.push(`${label}需要使用 http(s)、站内路径或已上传资源`)
    })
    if (schema) visit(schema.fields, values)
    if (name === 'gallery' && values.mode === 'url' && !String(values.dataUrl || '').trim()) errors.push('远程 JSON 地址不能为空')
    return errors
  }

  const summarizeEntry = entry => {
    const values = entry.values || valuesFromEntry(entry)
    const preferred = values.content || values.display || values.headline || values.name || values.source || values.body || entry.args
    return String(preferred || '点击设置组件内容').replace(/\s+/g, ' ').trim().slice(0, 96)
  }

  return {
    PLACEHOLDER_PATTERN_SOURCE,
    applyValues,
    defaultsFor,
    entryFromComponent,
    getSchema,
    parseRaw,
    protectMarkdown,
    restoreMarkdown,
    serializeEntry,
    summarizeEntry,
    validateValues,
    valuesFromEntry
  }
})
