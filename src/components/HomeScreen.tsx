import { useState } from 'react';
import {
  ChevronRight,
  Film,
  FolderOpen,
  Plus,
  Scissors,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ProjectDraft } from '../types/editor';
import { filterDrafts } from '../utils/drafts';
import { formatTimecode } from '../utils/timeline';

export type HomeTab = 'edit' | 'projects';

interface HomeScreenProps {
  activeTab: HomeTab;
  drafts: ProjectDraft[];
  importingMedia: boolean;
  importError: string | null;
  onChangeTab: (tab: HomeTab) => void;
  onStartEditing: () => void;
  onOpenDraft: (draftId: string) => void;
  onDeleteDraft: (draftId: string) => void;
}

export function HomeScreen({
  activeTab,
  drafts,
  importingMedia,
  importError,
  onChangeTab,
  onStartEditing,
  onOpenDraft,
  onDeleteDraft,
}: HomeScreenProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const visibleDrafts = filterDrafts(drafts, searchQuery);

  return (
    <div
      data-testid="home-screen"
      className="h-[100dvh] w-full flex flex-col bg-[#08080b] text-zinc-100 overflow-hidden pt-safe pb-safe relative"
    >
      {/* Atmospheric pink/purple top glow matching modern mobile studio launcher */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background:
            'radial-gradient(90% 70% at 15% 0%, rgba(236, 72, 153, 0.28), transparent 65%), radial-gradient(85% 75% at 88% 8%, rgba(139, 92, 246, 0.34), transparent 65%)',
        }}
      />

      {/* Top Bar: Import + Brand + Search */}
      <header className="relative z-10 h-14 shrink-0 px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onStartEditing}
            disabled={importingMedia}
            data-testid="home-import-btn"
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs sm:text-sm font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-50"
          >
            Import
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <svg
              width="24"
              height="24"
              viewBox="0 0 64 64"
              aria-hidden="true"
              className="shrink-0 rounded-md"
            >
              <defs>
                <linearGradient id="insho-home-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="16" fill="#121218" />
              <rect
                x="2"
                y="2"
                width="60"
                height="60"
                rx="14"
                fill="none"
                stroke="url(#insho-home-grad)"
                strokeWidth="3.5"
              />
              <path d="M20 20h24v6H35v18h-6V26h-9z" fill="#ffffff" />
              <circle cx="46" cy="43" r="4" fill="#ec4899" />
            </svg>
            <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white truncate">
              Insho Text
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setSearchOpen((prev) => {
              if (prev) setSearchQuery('');
              return !prev;
            });
          }}
          aria-label="Search drafts"
          aria-expanded={searchOpen}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white transition-colors shrink-0"
        >
          {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
        </button>
      </header>

      {/* Collapsible Draft Search Bar */}
      {searchOpen && (
        <div className="relative z-10 px-4 sm:px-6 pb-3">
          <div className="max-w-2xl mx-auto relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search drafts by clip name or code..."
              aria-label="Filter saved drafts"
              autoFocus
              className="w-full h-11 pl-10 pr-4 rounded-2xl bg-[#14141c]/95 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500"
            />
          </div>
        </div>
      )}

      {/* Main Scrollable Home Content */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3.5 sm:px-6 pb-4 sm:pb-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4 sm:gap-6 pt-1 sm:pt-2">
          {importError && (
            <div
              role="alert"
              className="rounded-2xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs text-rose-200"
            >
              {importError}
            </div>
          )}

          {activeTab === 'edit' ? (
            <>
              {/* Hero: Video create / Get started */}
              <section aria-label="Start new video" className="flex flex-col gap-2.5 sm:gap-3">
                <div>
                  <p className="text-xs font-medium text-zinc-300/90 tracking-wide">
                    Video create
                  </p>
                  <button
                    type="button"
                    onClick={onStartEditing}
                    className="mt-0.5 inline-flex items-center gap-1 font-display font-bold text-2xl sm:text-3xl tracking-tight text-white hover:text-pink-200 transition-colors"
                  >
                    <span>Get started</span>
                    <ChevronRight className="w-5 h-5 text-pink-400 mt-0.5" />
                  </button>
                </div>

                {/* Primary Start Editing Action Card */}
                <button
                  type="button"
                  onClick={onStartEditing}
                  disabled={importingMedia}
                  data-testid="start-editing-btn"
                  className="group w-full min-h-[116px] sm:min-h-[152px] rounded-3xl bg-white hover:bg-zinc-100 text-[#08080b] p-4 sm:p-6 shadow-[0_18px_45px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center gap-2 sm:gap-2.5 transition-all active:scale-[0.985] disabled:opacity-60"
                >
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                    <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
                  </div>
                  <div className="text-center">
                    <div className="font-display font-bold text-base sm:text-lg text-[#08080b]">
                      {importingMedia ? 'Loading media…' : 'Start editing'}
                    </div>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Select video or photo from your files
                    </p>
                  </div>
                </button>
              </section>

              {/* Edit Draft Horizontal Strip */}
              <section aria-label="Edit draft" className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold text-sm text-zinc-200">
                    Edit draft
                  </h2>
                  <button
                    type="button"
                    onClick={() => onChangeTab('projects')}
                    className="text-xs font-medium text-pink-400 hover:text-pink-300 flex items-center gap-0.5"
                  >
                    <span>Projects</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {visibleDrafts.length === 0 ? (
                  <div
                    data-testid="no-drafts-empty"
                    className="rounded-2xl border border-dashed border-white/12 bg-[#121218]/75 px-4 py-5 text-center flex flex-col items-center gap-1.5"
                  >
                    <Film className="w-5 h-5 text-purple-400" />
                    <p className="text-xs font-medium text-zinc-300">
                      {searchQuery.trim()
                        ? 'No matching drafts found'
                        : 'No drafts saved yet'}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {searchQuery.trim()
                        ? 'Try a different search keyword.'
                        : 'Tap Start editing above to pick a video or photo and begin.'}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                    {visibleDrafts.slice(0, 6).map((draft) => (
                      <button
                        key={draft.id}
                        type="button"
                        onClick={() => onOpenDraft(draft.id)}
                        data-testid={`draft-card-${draft.id}`}
                        aria-label={`Open draft ${draft.title}`}
                        className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-[#16161f] border border-white/12 hover:border-pink-500/70 shrink-0 group transition-colors text-left"
                      >
                        {draft.thumbnail ? (
                          <img
                            src={draft.thumbnail}
                            alt={draft.title}
                            className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-pink-500/20 to-purple-600/25 flex items-center justify-center">
                            <Film className="w-6 h-6 text-zinc-400" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono-tabular text-zinc-200">
                          {formatTimecode(draft.totalDuration)}
                        </span>
                        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1 text-[10px] font-medium text-white">
                          <Scissors className="w-3 h-3 text-pink-400 shrink-0" />
                          <span className="truncate font-mono-tabular">{draft.code}</span>
                        </div>
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => onChangeTab('projects')}
                      aria-label="View all draft projects"
                      className="w-14 h-24 sm:h-28 rounded-2xl bg-[#16161f] hover:bg-[#1f1f2b] border border-white/12 flex items-center justify-center text-zinc-300 hover:text-white shrink-0 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            /* Projects Tab (Full Edit Draft List) */
            <section aria-label="All edit drafts" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h1 className="font-display font-bold text-xl text-white">
                    Edit drafts
                  </h1>
                  <p className="text-xs text-zinc-400">
                    {visibleDrafts.length}{' '}
                    {visibleDrafts.length === 1 ? 'saved project' : 'saved projects'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onStartEditing}
                  disabled={importingMedia}
                  className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Start editing</span>
                </button>
              </div>

              {visibleDrafts.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/12 bg-[#121218] p-8 text-center flex flex-col items-center gap-3">
                  <FolderOpen className="w-8 h-8 text-purple-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {searchQuery.trim() ? 'No matching projects' : 'No saved drafts yet'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Import a video or photo with Start editing and your cuts will appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {visibleDrafts.map((draft) => (
                    <div
                      key={draft.id}
                      className="rounded-2xl bg-[#121218] border border-white/10 hover:border-pink-500/50 p-2.5 flex items-center gap-3 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenDraft(draft.id)}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      >
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-zinc-900 shrink-0 relative">
                          {draft.thumbnail ? (
                            <img
                              src={draft.thumbnail}
                              alt={draft.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-500/20 to-purple-600/20">
                              <Film className="w-5 h-5 text-zinc-400" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">
                            {draft.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400 font-mono-tabular">
                            <span>{draft.code}</span>
                            <span>·</span>
                            <span>{formatTimecode(draft.totalDuration)}</span>
                            <span>·</span>
                            <span>{draft.aspectRatio}</span>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteDraft(draft.id)}
                        aria-label={`Delete draft ${draft.title}`}
                        className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 shrink-0 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Bottom Navigation Bar: Edit & Projects (matching screenshot) */}
      <nav
        aria-label="Home navigation"
        className="relative z-10 h-16 shrink-0 border-t border-white/10 bg-[#0d0d12]/95 backdrop-blur-md grid grid-cols-2"
      >
        <button
          type="button"
          onClick={() => onChangeTab('edit')}
          data-testid="home-tab-edit"
          aria-pressed={activeTab === 'edit'}
          className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
            activeTab === 'edit'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Scissors
            className={`w-5 h-5 ${activeTab === 'edit' ? 'text-pink-400' : ''}`}
          />
          <span>Edit</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeTab('projects')}
          data-testid="home-tab-projects"
          aria-pressed={activeTab === 'projects'}
          className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
            activeTab === 'projects'
              ? 'text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <FolderOpen
            className={`w-5 h-5 ${activeTab === 'projects' ? 'text-purple-400' : ''}`}
          />
          <span>Projects</span>
        </button>
      </nav>
    </div>
  );
}
