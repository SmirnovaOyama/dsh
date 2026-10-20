import { ChevronRight, Circle, CircleCheck, CircleDot, ListTodo } from 'lucide-react'
import { useState } from 'react'
import type { Todo } from '../../shared/types'
import { t } from '../i18n'
import { Icon } from './Icon'

const ICON = { pending: Circle, in_progress: CircleDot, completed: CircleCheck } as const

/**
 * The agent's to-do list, pinned above the composer while it works. Folded, it is one line with the
 * count and the step in progress; open, it lists every step.
 */
export function TodoPanel({ todos, running }: { todos: Todo[]; running: boolean }) {
  const [open, setOpen] = useState(true)
  const done = todos.filter((todo) => todo.status === 'completed').length
  // Once everything is done and the agent stopped, the list has served its purpose.
  if (!todos.length || (done === todos.length && !running)) return null
  const current = todos.find((todo) => todo.status === 'in_progress')
  return (
    <section className="hx-todos" aria-label={t('todos.label')}>
      <button type="button" className="head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon icon={ListTodo} size={16} />
        <span className="title">{t('todos.title')}</span>
        <span className="count">{t('todos.count', { done, total: todos.length })}</span>
        {!open && current && <span className="now">{current.content}</span>}
        <span className="grow" />
        <Icon icon={ChevronRight} size={16} className="hx-chev" />
      </button>
      <div className={`hx-disc ${open ? 'is-open' : ''}`}>
        <div>
          <ol className="list">
            {todos.map((todo, i) => (
              <li key={i} className={`is-${todo.status}`}>
                <Icon icon={ICON[todo.status]} size={16} />
                <span>{todo.content}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
