import { useMemo, useState } from "react";
import { AlertDialog, Button, Card, SearchField, Tooltip } from "@heroui/react";
import { AlertTriangle, FileMusic, FolderOpen, RefreshCw, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { command, isTauri } from "../lib/tauri";
import { useAppStore } from "../store";
import type { LibraryEntry } from "../types";

type LibraryFilter = "all" | "errors";

export function LibraryPage() {
  const { config, library, setLibrary, patchConfig } = useAppStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<LibraryEntry | null>(null);

  const errorCount = library.filter((item) => item.parseError).length;
  const filteredLibrary = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return library.filter((entry) => {
      if (filter === "errors" && !entry.parseError) return false;
      return !needle || [entry.fileName, entry.path, entry.format].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [filter, library, query]);

  const refresh = async () => {
    if (!isTauri() || isIndexing) return;
    setIsIndexing(true); setMessage(null);
    try { setLibrary(await command<LibraryEntry[]>("index_lyrics_library")); }
    catch (error) { setMessage(`No se pudo actualizar la biblioteca. ${String(error)}`); }
    finally { setIsIndexing(false); }
  };

  const saveFolders = async (folders: string[]) => {
    patchConfig({ localLyricsFolders: folders });
    await command("update_config", { patch: { localLyricsFolders: folders } });
    await refresh();
  };

  const addFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Selecciona una carpeta de letras" });
    if (!selected || Array.isArray(selected)) return;
    await saveFolders([...new Set([...config.localLyricsFolders, selected])]);
  };

  const removeEntry = async () => {
    if (!pendingRemoval) return;
    const entry = pendingRemoval; setPendingRemoval(null); setBusyId(entry.id); setMessage(null);
    try { setLibrary(await command<LibraryEntry[]>("remove_library_entry", { id: entry.id })); }
    catch (error) { setMessage(`No se pudo quitar la letra. ${String(error)}`); }
    finally { setBusyId(null); }
  };

  return (
    <main className="page library-page">
      <header className="page-header">
        <div><h1>Letras locales</h1><p>Busca y administra los archivos TTML, LRC y ELRC guardados en este PC.</p></div>
        <div className="header-actions"><Button variant="secondary" onPress={refresh} isDisabled={isIndexing} isPending={isIndexing}><RefreshCw size={16} />{isIndexing ? "Indexando" : "Reindexar"}</Button><Button onPress={addFolder}><FolderOpen size={16} />Añadir carpeta</Button></div>
      </header>

      <section className="library-toolbar" aria-label="Filtros y búsqueda">
        <div className="library-filters" role="group" aria-label="Filtrar biblioteca">
          <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} aria-pressed={filter === "all"} onPress={() => setFilter("all")}>{library.length} {library.length === 1 ? "archivo" : "archivos"}</Button>
          <Button size="sm" variant={filter === "errors" ? "secondary" : "ghost"} aria-pressed={filter === "errors"} onPress={() => setFilter("errors")} className={errorCount ? "filter-errors" : undefined}>{errorCount} con errores</Button>
        </div>
        <SearchField className="library-search" value={query} onChange={setQuery} aria-label="Buscar letras"><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Buscar por nombre o ruta" /><SearchField.ClearButton /></SearchField.Group></SearchField>
      </section>

      {config.localLyricsFolders.length > 0 && <section className="library-folders" aria-label="Carpetas indexadas">{config.localLyricsFolders.map((folder) => <div className="folder-row" key={folder}><FolderOpen size={14} /><Tooltip delay={450}><Tooltip.Trigger><span title={folder}>{folder}</span></Tooltip.Trigger><Tooltip.Content placement="top">{folder}</Tooltip.Content></Tooltip><Button isIconOnly size="sm" variant="ghost" onPress={() => void saveFolders(config.localLyricsFolders.filter((value) => value !== folder))} aria-label={`Dejar de indexar ${folder}`}><X size={13} /></Button></div>)}</section>}
      {message && <div className="library-message" role="alert"><AlertTriangle size={16} /><span>{message}</span></div>}

      {config.localLyricsFolders.length === 0 ? (
        <section className="empty-library"><FileMusic size={30} strokeWidth={1.5} /><h2>Añade una carpeta</h2><p>UxNow indexará los archivos compatibles y omitirá los que no pueda leer.</p><Button onPress={addFolder}><FolderOpen size={16} />Elegir carpeta</Button></section>
      ) : (
        <Card className="library-list ux-card" variant="secondary"><Card.Content>
          <div className="library-list-head"><span>Archivo</span><span>Acciones</span></div>
          {filteredLibrary.map((entry) => <LibraryRow key={entry.id} entry={entry} busy={busyId === entry.id} onReveal={(path) => command("reveal_file", { path })} onRemove={setPendingRemoval} />)}
          {!library.length && <div className="empty-row">No se encontraron archivos compatibles.</div>}
          {!!library.length && !filteredLibrary.length && <div className="empty-row">No hay resultados con este filtro.</div>}
        </Card.Content></Card>
      )}

      <AlertDialog><AlertDialog.Backdrop variant="blur" isOpen={Boolean(pendingRemoval)} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}><AlertDialog.Container size="sm"><AlertDialog.Dialog><AlertDialog.Header><AlertDialog.Icon status="danger"><Trash2 size={20} /></AlertDialog.Icon><AlertDialog.Heading>Quitar de la biblioteca</AlertDialog.Heading></AlertDialog.Header><AlertDialog.Body><p><strong>{pendingRemoval?.fileName}</strong> dejará de aparecer en UxNow. El archivo seguirá en tu equipo.</p></AlertDialog.Body><AlertDialog.Footer><Button variant="tertiary" onPress={() => setPendingRemoval(null)}>Cancelar</Button><Button variant="danger" onPress={removeEntry}>Quitar</Button></AlertDialog.Footer></AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop></AlertDialog>
    </main>
  );
}

function LibraryRow({ entry, busy, onReveal, onRemove }: { entry: LibraryEntry; busy: boolean; onReveal: (path: string) => void; onRemove: (entry: LibraryEntry) => void }) {
  return <article className="library-row"><div className="file-cell"><span className={`file-icon ${entry.parseError ? "has-error" : ""}`}>{entry.parseError ? <AlertTriangle /> : <FileMusic />}</span><span><span className="file-title"><strong>{entry.fileName}</strong><span className="format-tag">{entry.format.toUpperCase()}</span></span><Tooltip delay={500}><Tooltip.Trigger><small className="file-path" title={entry.path}>{entry.path}</small></Tooltip.Trigger><Tooltip.Content placement="top">{entry.path}</Tooltip.Content></Tooltip>{entry.parseError && <em>{entry.parseError}</em>}</span></div><div className="library-actions"><Button size="sm" variant="ghost" onPress={() => onReveal(entry.path)}>Abrir ubicación</Button><Button isIconOnly size="sm" variant="ghost" isDisabled={busy} onPress={() => onRemove(entry)} aria-label={`Quitar ${entry.fileName} del índice`}><Trash2 size={15} /></Button></div></article>;
}
