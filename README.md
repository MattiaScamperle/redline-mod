# barra-utilizzo

Mod per Claude Code che mostra, sopra la casella in cui scrivi, una banda con:

- **5h**: quanto hai usato del limite di 5 ore e tra quanto si azzera;
- **7g**: quanto hai usato del limite settimanale e tra quanto si azzera;
- **ctx**: quanto è pieno il contesto della chat (token usati / finestra);
- un bottone **Compatta** che compatta il contesto come `/compact`.

Le barre cambiano colore da verde ad arancione a rosso man mano che la percentuale sale, si aggiornano ogni pochi secondi anche durante una risposta e vanno a capo da sole quando la finestra è stretta. I limiti 5h e 7g sono dell'account: l'ultima lettura di una chat viene condivisa con le altre, così anche una chat appena aperta li mostra.

## Installazione

Al prompt di una sessione Claude Code nel terminale:

```
/plugin install barra-utilizzo --marketplace MattiaScamperle/barra-utilizzo
```

Da una shell:

```bash
claude plugin install barra-utilizzo --marketplace MattiaScamperle/barra-utilizzo
```

Nell'app desktop, dove `/plugin` non è disponibile: clicca + accanto alla casella del prompt, poi Plugins, Add marketplace con `MattiaScamperle/barra-utilizzo`, poi Add plugin.

## Licenza

Copyright (c) 2026 MattiaScamperle. Distribuita con licenza GNU GPL v3 (GPL-3.0-only), vedi [LICENSE](LICENSE).
