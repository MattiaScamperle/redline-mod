# redline-mod

Mod per Claude Code che mostra, sopra la casella in cui scrivi, una banda con:

- **5h**: quanto hai usato del limite di 5 ore, l'ora del reset e tra quanto si azzera;
- **7g**: quanto hai usato del limite settimanale, giorno e ora del reset e tra quanto si azzera;
- **ctx**: quanto è pieno il contesto della chat (token usati / finestra);
- un bottone **Compatta** che compatta il contesto come `/compact`: compare dal 26% di contesto e si evidenzia sopra il 70%.

Sotto 5h e 7g, se al ritmo attuale il limite finisce prima del reset, compare una stima in arancione: `~ a questo ritmo finisci le 5h 19:10`.

Le barre hanno una sfumatura da verde a giallo, arancione e rosso (una cella per colore) man mano che la percentuale sale, si aggiornano ogni pochi secondi anche durante una risposta e vanno a capo da sole quando la finestra è stretta. I limiti 5h e 7g sono dell'account: l'ultima lettura di una chat viene condivisa con le altre, così anche una chat appena aperta li mostra. All'avvio, se nessuna chat ha ancora un dato, la mod fa una sola richiesta minima a Haiku (pochi token, al massimo una ogni due minuti per tutte le chat) per caricare subito i valori esatti.

## Installazione

Al prompt di una sessione Claude Code nel terminale:

```
/plugin install redline-mod --marketplace MattiaScamperle/redline-mod
```

Da una shell:

```bash
claude plugin install redline-mod --marketplace MattiaScamperle/redline-mod
```

Nell'app desktop, dove `/plugin` non è disponibile: clicca + accanto alla casella del prompt, poi Plugins, Add marketplace con `MattiaScamperle/redline-mod`, poi Add plugin.

## Licenza

Copyright (c) 2026 MattiaScamperle. Distribuita con licenza GNU GPL v3 (GPL-3.0-only), vedi [LICENSE](LICENSE).
