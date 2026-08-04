(function (root, factory) {
  'use strict'

  const api = factory(root?.MarkdownEditorCore)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.MarkdownMediaStore = api
})(typeof globalThis === 'undefined' ? this : globalThis, core => {
  'use strict'

  const DATABASE_NAME = 'charliezc-markdown-media-v1'
  const STORE_NAME = 'assets'
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  const FILE_EXTENSIONS = new Set(['pdf', 'txt', 'csv', 'zip', 'docx', 'xlsx', 'pptx'])
  const IMAGE_LIMIT = 5 * 1024 * 1024
  const FILE_LIMIT = 15 * 1024 * 1024
  const BATCH_LIMIT = 30 * 1024 * 1024

  const extensionOf = name => String(name || '').split('.').pop().toLowerCase()
  const isImage = file => IMAGE_TYPES.has(String(file?.type || '').toLowerCase()) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extensionOf(file?.name))

  const validateFile = (file, currentTotal = 0) => {
    if (!file || typeof file.size !== 'number') throw new Error('无法读取该文件。')
    const extension = extensionOf(file.name)
    if (String(file.type || '').toLowerCase() === 'image/svg+xml' || extension === 'svg') throw new Error('为避免活动脚本风险，暂不支持 SVG。')
    const image = isImage(file)
    if (!image && !FILE_EXTENSIONS.has(extension)) throw new Error(`不支持 .${extension || '未知'} 文件。`)
    const limit = image ? IMAGE_LIMIT : FILE_LIMIT
    if (file.size > limit) throw new Error(`${image ? '图片' : '文件'}不能超过 ${limit / 1024 / 1024} MiB。`)
    if (currentTotal + file.size > BATCH_LIMIT) throw new Error('当前文稿的待发布资源合计不能超过 30 MiB。')
    return { extension, image, limit }
  }

  const openDatabase = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB，无法暂存附件。'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('documentId', 'documentId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开资源存储失败。'))
  })

  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('资源存储操作失败。'))
  })

  const digestFile = async file => {
    if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持文件指纹计算。')
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  const list = async documentId => {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const index = transaction.objectStore(STORE_NAME).index('documentId')
      const records = await requestResult(index.getAll(String(documentId || '')))
      return records.sort((left, right) => left.createdAt - right.createdAt)
    } finally {
      database.close()
    }
  }

  const get = async id => {
    const database = await openDatabase()
    try {
      return await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(String(id || '')))
    } finally {
      database.close()
    }
  }

  const add = async (file, documentId) => {
    const existing = await list(documentId)
    const total = existing.reduce((sum, record) => sum + Number(record.size || 0), 0)
    const validation = validateFile(file, total)
    const hash = await digestFile(file)
    const safeName = core?.sanitizeAssetFileName ? core.sanitizeAssetFileName(file.name) : String(file.name || 'file').replace(/[^a-z0-9._-]+/gi, '-')
    const id = `${hash.slice(0, 20)}-${String(documentId || '').replace(/[^a-z0-9]/gi, '').slice(-8) || 'document'}`.toLowerCase()
    const record = {
      id,
      documentId: String(documentId || ''),
      name: safeName,
      originalName: String(file.name || safeName),
      remoteName: `${hash.slice(0, 12)}-${safeName}`,
      type: String(file.type || 'application/octet-stream'),
      size: file.size,
      hash,
      isImage: validation.image,
      createdAt: Date.now(),
      blob: file
    }
    const database = await openDatabase()
    try {
      await requestResult(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record))
    } finally {
      database.close()
    }
    return record
  }

  const remove = async id => {
    const database = await openDatabase()
    try {
      await requestResult(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(String(id || '')))
    } finally {
      database.close()
    }
  }

  const removeMany = async ids => Promise.all(Array.from(ids || []).map(remove))

  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取文件失败。'))
    reader.readAsDataURL(blob)
  })

  const formatBytes = value => {
    const bytes = Number(value || 0)
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  }

  return {
    BATCH_LIMIT,
    FILE_LIMIT,
    IMAGE_LIMIT,
    add,
    blobToBase64,
    formatBytes,
    get,
    isImage,
    list,
    remove,
    removeMany,
    validateFile
  }
})
