'use client'

import dynamic from 'next/dynamic'
import { useRef } from 'react'

// Monaco must be loaded client-side only
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface SqlEditorProps {
  value: string
  onChange: (val: string) => void
  onRun: () => void
  height?: string
}

export function SqlEditor({ value, onChange, onRun, height = '220px' }: SqlEditorProps) {
  const editorRef = useRef<unknown>(null)

  const handleMount = (editor: unknown) => {
    editorRef.current = editor

    // Cmd/Ctrl+Enter to run
    const monacoEditor = editor as {
      addAction: (action: {
        id: string
        label: string
        keybindings: number[]
        run: () => void
      }) => void
      getModel: () => { getLanguageId: () => string } | null
    }

    monacoEditor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [
        // monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter — use raw values
        2048 | 3, // CtrlCmd + Enter
      ],
      run: onRun,
    })
  }

  return (
    <div className="rounded-md overflow-hidden border border-border">
      <MonacoEditor
        height={height}
        language="sql"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          wordWrap: 'on',
          tabSize: 2,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          padding: { top: 12, bottom: 12 },
          scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4 },
        }}
      />
    </div>
  )
}
