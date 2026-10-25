# Obake

Repository: [Capobuf/obake](https://github.com/Capobuf/obake).

Base applicativa Laravel 13 creata con lo starter kit React ufficiale. Include React 19 con TypeScript, Inertia.js 3, Tailwind CSS 4, shadcn/ui, Vite e autenticazione Laravel Fortify.

## Installazione su CloudPanel (da zero, senza Docker)

Questa procedura usa lo **ZIP di produzione** generato da GitHub Actions. Contiene le dipendenze PHP (`vendor/`) e il frontend gia compilato (`public/build/`): **non servono Composer, Node.js, npm o Docker sul server**. Serve un nuovo sito CloudPanel con un **database MySQL vuoto**. Non e un installer web e non e una procedura di aggiornamento di un'installazione esistente.

### 1. Scaricare lo ZIP

1. Aprire [GitHub Actions - Production ZIP](https://github.com/Capobuf/obake/actions/workflows/production-zip.yml).
2. Scegliere **Run workflow** sul branch `main` (oppure aprire un'esecuzione completata associata a un tag `v*`).
3. Aprire il workflow completato con esito positivo e, nella sezione **Artifacts**, scaricare `obake-production-<numero>`. Il download e gia uno ZIP pronto da estrarre, senza ZIP annidati. GitHub puo richiedere l'accesso e conserva l'artifact per 90 giorni.

**Non usare** il pulsante **Code -> Download ZIP** o gli archivi automatici **Source code** delle release: contengono i sorgenti, non il pacchetto pronto da installare.

### 2. Creare il sito e il database

1. In CloudPanel v2 aprire **Add Site -> Create a PHP Site**, selezionare l'applicazione **Laravel 13** e indicare dominio e utente del sito (**Site User**). Selezionare PHP **8.4.27 o successivo**, oppure **8.5.12 o successivo**. Sono necessari sia PHP-FPM sia PHP CLI aggiornati: le versioni precedenti non soddisfano i requisiti di Obake.
2. In **Domain / Root Directory**, verificare che la directory pubblica termini con `/htdocs/NOME_DOMINIO/public`. Non esporre la directory principale di Laravel.
3. In **Databases -> Add Database**, creare un **nuovo database vuoto**, con utente e password dedicati. Annotare nome del database, utente e password. Per installazione e ripristino globale si raccomanda MySQL 8.4.
4. Configurare DNS e, in **SSL/TLS**, il certificato HTTPS del dominio.

### 3. Caricare l'applicazione

**Attenzione alla cartella di estrazione:** lo ZIP contiene gia una directory `public/`. CloudPanel puo mostrare nel File Manager la directory pubblica del sito: **se il percorso corrente termina in `/public`, salire di un livello prima di caricare o estrarre lo ZIP**. Altrimenti si ottiene `public/public/` e il sito puo continuare a mostrare **Hello World :-)**.

1. Aprire il **File Manager** del sito CloudPanel e verificare il percorso corrente.
2. Posizionarsi **esattamente in** `/home/UTENTE_SITO/htdocs/NOME_DOMINIO/`, ossia la cartella che deve contenere sia `artisan` sia `public/`. **Non estrarre in** `/home/UTENTE_SITO/htdocs/NOME_DOMINIO/public/`.
3. Caricare lo ZIP scaricato da GitHub ed estrarlo nella cartella corretta. Non caricare o estrarre uno ZIP di nuova installazione sopra un sito gia in uso.
4. Verificare la struttura risultante:

```text
/home/UTENTE_SITO/htdocs/NOME_DOMINIO/
├── .env.example
├── artisan
├── app/
├── bootstrap/
├── config/
├── database/
├── public/
│   ├── index.php
│   └── build/
├── resources/
├── routes/
├── storage/
└── vendor/
```

**Percorso errato:** `.../htdocs/NOME_DOMINIO/public/public/index.php`. Se compare, il contenuto dello ZIP e stato estratto nella directory pubblica invece che nella root dell'applicazione. Correggere **l'intera posizione dell'installazione**, non spostare solo `index.php` o la seconda cartella `public`; ripristinare la struttura illustrata sopra, inclusi i file nascosti.

Infine, verificare che `public/index.php` contenga il riferimento a `../vendor/autoload.php` e che `public/build/manifest.json` esista. Se e rimasto un `public/index.html` predefinito con **Hello World :-)**, rimuovere **solo quel file di esempio**. La **Root Directory** configurata in CloudPanel deve puntare a `.../htdocs/NOME_DOMINIO/public` (un solo `public`).

### 4. Configurare database e indirizzo del sito

Accedere via SSH **come Site User**, non come root (sostituire i valori di esempio):

```sh
ssh UTENTE_SITO@IP_SERVER
cd ~/htdocs/NOME_DOMINIO
cp .env.example .env
```

Non bisogna scrivere o creare manualmente alcun file: il comando copia il modello di produzione incluso nello ZIP. Aprire poi `.env` con l'editor del **File Manager** di CloudPanel e modificare **solo** i valori seguenti:

```dotenv
APP_URL=https://app.example.it
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=nome_database_creato
DB_USERNAME=utente_database_creato
DB_PASSWORD="password_database"
```

`APP_ENV=production` e `APP_DEBUG=false` sono gia impostati. Conservare le virgolette intorno alla password del database, soprattutto se contiene caratteri speciali. Non modificare `APP_KEY` manualmente.

### 5. Inizializzare Obake

Sempre nella directory del sito, eseguire i comandi nell'ordine indicato:

```sh
php8.4 -v
php8.4 artisan key:generate --force
php8.4 artisan migrate --force
php8.4 artisan app:create-superuser
php8.4 artisan optimize
```

Se e stato selezionato PHP 8.5 in CloudPanel, sostituire **`php8.4` con `php8.5`** in tutti i comandi, anche nel cron. Il comando per l'amministratore chiede interattivamente nome, email e password. **Non eseguire `db:seed` o `migrate:fresh`**: il primo crea dati di test, il secondo cancella le tabelle. Fermarsi se il database non e vuoto o una migration restituisce un errore.

### 6. Attivare le operazioni pianificate

In CloudPanel aprire **Cron Jobs** del sito, creare un cron **ogni minuto** ed inserire come **Command** (non includere `* * * * *`, che va nel campo di pianificazione):

```sh
cd /home/UTENTE_SITO/htdocs/NOME_DOMINIO && /usr/bin/php8.4 artisan schedule:run >> storage/logs/scheduler.log 2>&1
```

Sostituire `UTENTE_SITO` e `NOME_DOMINIO` con i valori reali, e il binario PHP se necessario. Il cron deve essere eseguito come **Site User**. E sufficiente questo unico cron per promemoria contratti, backup programmati, pulizia Undo e sincronizzazione Google Drive.

### 7. Primo accesso e verifiche

1. Aprire `APP_URL` nel browser ed entrare con l'amministratore appena creato.
2. Aprire **Impostazioni Piattaforma -> Email**, configurare SMTP e inviare un'email di test. Finche SMTP non e configurato, i messaggi esterni (inviti, recupero password, promemoria) non vengono recapitati.
3. In CloudPanel verificare i limiti PHP di upload: con il default di 2 MB per allegato servono almeno `upload_max_filesize=2M` e `post_max_size` superiore (es. `3M`). Adeguarli se si aumenta il limite in Amministrazione → Generali. Per ripristinare backup dalla pagina web servono limiti piu elevati, adeguati allo ZIP caricato.
4. Per i backup globali verificare da SSH la disponibilita di `mysqldump`, `mysql` e `zip` per il Site User, oltre allo spazio libero e ai permessi di `storage/` e `bootstrap/cache/`. Provare almeno un backup reale.

**In caso di errore:** se compare **Hello World :-)**, controllare **prima** che lo ZIP non sia stato estratto in `public/`, creando il percorso errato `public/public/`. Poi verificare la Root Directory CloudPanel, l'eventuale `public/index.html` di esempio, i valori in `.env`, la versione PHP CLI/FPM e `storage/logs/laravel.log`. Non impostare permessi `777`.

### Aggiornare un sito esistente con GitHub Actions

La **CI** su `main` esegue i controlli e, soltanto dopo il loro successo, richiama **Production ZIP** per pubblicare `obake-production-<numero run CI>`. Lo ZIP contiene il commit in `.release-commit` e `public/build/release.txt`. Il workflow **Deploy** parte automaticamente quando la CI di `main` termina con successo e riutilizza esattamente quell'artifact: verifica run, branch, commit e digest SHA-256. Le CI delle pull request, dei fork o fallite non pubblicano. Se `main` avanza prima dell'avvio o durante il trasferimento, la vecchia run non viene installata; il nuovo commit richiede la propria CI riuscita. Non compila sul server e non usa automaticamente l'ultimo ZIP disponibile. Gli ZIP prodotti separatamente dal workflow Production ZIP non sono accettati dal deploy.

#### Prima configurazione

Usare il **Site User**, una chiave SSH dedicata e una chiave host verificata. Nell'Environment **`Cloudpanel`**, limitato al branch `main`, senza revisori obbligatori né timer di attesa per consentire gli aggiornamenti automatici, configurare questi **Environment Secrets**:

| Secret               | Valore                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | Host SSH                                                                            |
| `DEPLOY_USER`        | Site User, mai root                                                                 |
| `DEPLOY_ROOT`        | Percorso assoluto della cartella base che contiene `releases`, `current` e `shared` |
| `DEPLOY_URL`         | URL pubblico HTTPS dell'applicazione                                                |
| `DEPLOY_DOMAIN`      | Hostname pubblico senza schema, coerente con l'URL                                  |
| `DEPLOY_PHP`         | Percorso assoluto del binario PHP CLI 8.5                                           |
| `DEPLOY_SSH_KEY`     | Chiave privata Ed25519 dedicata, senza passphrase                                   |
| `DEPLOY_KNOWN_HOSTS` | Voce `known_hosts` del server                                                       |
| `DEPLOY_SSH_PORT`    | Solo se diversa da 22                                                               |

Non inserire valori reali in GitHub Variables, input dei workflow, file versionati, log o artifact. CI e packaging non accedono all'Environment di produzione. Se si accetta la chiave host al primo accesso senza confronto del fingerprint da una fonte indipendente, la chiave resta fissata per le connessioni successive, ma l'identità iniziale del server non è verificata.

Il server deve avere Python 3.11 o successivo e il Site User deve poter eseguire esclusivamente il reload necessario: `sudo -n /usr/bin/systemctl reload php8.5-fpm.service`.

Prima del primo deploy predisporre la struttura seguente senza spostare o sovrascrivere dati attivi:

```text
<DEPLOY_ROOT>/
  current -> .                 # inizialmente serve l'installazione esistente
  releases/                    # nuove release, ciascuna in una cartella distinta
  storage/                     # dati attivi dell'installazione iniziale
  shared/storage -> ../storage
  public/                      # document root precedente
```

Conservare in `~/.dploy/overlays/.env` una copia identica del `.env` attivo, con permessi `600`. Se `shared/storage` contiene già una copia separata, conservarla prima di creare il collegamento ai dati realmente in uso; non sostituire lo storage attivo con quella copia. Solo dopo aver verificato `current`, cambiare la Root Directory in CloudPanel a `<DEPLOY_ROOT>/current/public` e verificare HTTPS e `/up`.

Il deploy riutilizza la struttura e l'overlay predisposti per dploy, ma non esegue `dploy deploy`: quel comando clona un branch o tag Git e non installa lo ZIP verificato. Non alternare i due metodi sullo stesso sito. Il workflow **SSH check** consente di verificare accesso, root Laravel e PHP senza effettuare il rilascio.

Dopo il passaggio, eseguire i comandi Artisan da `<DEPLOY_ROOT>/current`. Anche un eventuale cron dello scheduler deve usare `<DEPLOY_ROOT>/current/artisan`; il codice conservato nella cartella iniziale serve come ripristino del primo rilascio e non viene aggiornato.

#### Aggiornamenti automatici da main

1. Integrare la modifica in `main`: la CI verifica l'applicazione e crea il Production ZIP.
2. Dopo il successo della CI, il workflow **Deploy** parte automaticamente. Non occorre premere **Run workflow** o approvare l'Environment.
3. Verificare `ARTIFACT=OK`, `SSH=OK`, `TARGET=OK`, `DEPLOY=OK` e `HTTP=OK`. Il controllo HTTP verifica sia `/up` sia il commit pubblicato in `build/release.txt`.

Le nuove migration incluse nel pacchetto vengono eseguite automaticamente con `php artisan migrate --force --no-interaction`, in manutenzione e prima del cambio di release. Se falliscono, il deploy si interrompe e ripristina l'accesso; eventuali modifiche già applicate al database non vengono annullate automaticamente. Modifiche o rimozioni di migration già presenti sono sempre rifiutate.

L'avvio manuale rimane disponibile per ritentare un rilascio: usare **Actions → Deploy → Run workflow** su `main` e inserire in `ci_run_id` il numero nell'URL della CI riuscita (`actions/runs/<numero>`), non quello nel nome dell'artifact. Nel solo avvio manuale `allow_migrations` è disattivato per impostazione predefinita: attivarlo se il pacchetto aggiunge migration. La CI selezionata deve corrispondere all'attuale commit `main`; non permette di distribuire una versione precedente. La rimozione dei revisori dell'Environment rende automatico anche l'accesso ai secret per i workflow autorizzati su `main`: il controllo delle modifiche prima del merge resta quindi essenziale.

Lo ZIP viene estratto in una nuova release. `.env`, `storage` e `public/storage` vengono collegati ai dati già presenti; le cache Laravel vengono generate sul server. Il collegamento `current` cambia solo dopo i controlli, poi viene ricaricato PHP-FPM. Le eventuali nuove migration vengono eseguite in manutenzione, ripristinando l'accesso anche in caso di errore.

Se il controllo successivo al cambio di release fallisce e non sono state eseguite migration, viene ripristinato il collegamento precedente. **Non viene mai effettuato un rollback automatico del database.** Dopo un errore di migration o un fallimento successivo a una modifica dello schema, verificare lo stato e usare i backup esistenti per un eventuale ripristino manuale. Le release precedenti e quelle fallite vengono conservate: controllare lo spazio disponibile e rimuoverle soltanto dopo una verifica, senza toccare `shared`, lo storage attivo o la release corrente.

Riferimenti CloudPanel: [Laravel](https://www.cloudpanel.io/docs/v2/php/applications/laravel/), [File Manager](https://www.cloudpanel.io/docs/v2/frontend-area/file-manager/), [Databases](https://www.cloudpanel.io/docs/v2/frontend-area/databases/), [Cron Jobs](https://www.cloudpanel.io/docs/v2/frontend-area/cron-jobs/).

## Requisiti per lo sviluppo

- Docker Desktop con Docker Compose per l'ambiente consigliato
- Composer 2 e PHP 8.4.27+ oppure 8.5.12+
- In alternativa a Docker: MySQL/MariaDB, Node.js e npm

## Sviluppo con Docker

Laravel Sail configura due soli servizi: l'applicazione PHP 8.4 e MySQL 8.4. Da PowerShell:

```powershell
composer install
Copy-Item .env.example .env
php artisan key:generate
docker compose up -d --build
docker compose exec laravel.test php artisan migrate --seed
docker compose exec laravel.test php artisan app:create-superuser
docker compose exec laravel.test npm ci
docker compose exec laravel.test npm run build
```

L'applicazione è disponibile su `http://localhost:8000`; MySQL è esposto su `localhost:3306`. Per avviare Vite con hot reload durante lo sviluppo:

```powershell
docker compose exec laravel.test npm run dev
```

Per arrestare l'ambiente senza eliminare il volume del database:

```powershell
docker compose stop
```

Il comando `app:create-superuser` richiede interattivamente nome, email e password. Non promuove account già esistenti e non salva credenziali nel repository.

### Aggiornamento di sicurezza PHP2Shell

Le vulnerabilità [CVE-2026-109618 e CVE-2026-109619](https://www.php.net/archive/2026.php#2026-10-21-5)
richiedono un runtime PHP corretto: per il ramo 8.4 usato da Sail serve **8.4.27
o successivo**; per il ramo 8.5 serve **8.5.12 o successivo**. Composer rifiuta
le versioni precedenti. Le sole impostazioni PHP o un aggiornamento Laravel
non risolvono le vulnerabilità.

Per un ambiente gestito dal Compose del repository, ricostruire senza cache
per scaricare i pacchetti PHP aggiornati, poi ricreare il servizio applicativo:

```sh
docker compose build --pull --no-cache laravel.test
docker compose run --rm --no-deps laravel.test php -v
docker compose run --rm --no-deps laravel.test composer check-platform-reqs --lock
docker compose up -d --no-deps laravel.test
docker compose exec laravel.test composer install --no-interaction
docker compose exec laravel.test npm ci
docker compose exec laravel.test npm run build
docker compose exec laravel.test php artisan optimize:clear
docker compose exec laravel.test php -v
docker compose exec laravel.test composer check-platform-reqs
docker compose ps
```

Verificare la versione corretta prima di sostituire il servizio e la risposta
HTTP dopo il riavvio. Non sono necessarie migration; conservare database,
volumi e allegati. Su hosting tradizionale aggiornare anche il runtime del
web server e riavviare tutti i worker PHP: aggiornare soltanto la CLI non basta.

Nell'ambiente esistente `10.0.0.30:8000`, `mp3-app` è un container autonomo
con bind mount di `/root/MP3`: aggiornare i suoi pacchetti PHP e riavviarlo,
poi usare `docker exec mp3-app` per installazione, build e verifiche.
Non avviare un secondo progetto Compose sugli stessi dati. Il repository APT
e la chiave da usare sono quelli del Dockerfile Sail 8.4 installato in
`vendor/laravel/sail/runtimes/8.4/Dockerfile`.

## Aggiornamento del nome prodotto

Negli ambienti già installati impostare solo `APP_NAME=Obake` nel proprio `.env`,
senza sostituire il file o i suoi segreti. `VITE_APP_NAME` e `MAIL_FROM_NAME`
nell'esempio derivano da `${APP_NAME}`: se erano stati impostati esplicitamente,
verificarli e aggiornare il solo nome prodotto. Ricompilare gli asset e lanciare
`php artisan optimize:clear`. Un mittente SMTP personalizzato salvato nelle
impostazioni della piattaforma resta sotto il controllo dell'amministratore.
Il cambio di `APP_NAME` può richiedere un nuovo login perché Laravel ne deriva
il nome del cookie, salvo `SESSION_COOKIE` esplicito.

I comandi preferiti sono `obake:backup`, `obake:restore` e `obake:drive-sync`;
`mp3:backup`, `mp3:restore` e `mp3:drive-sync` restano alias compatibili,
con gli stessi argomenti e opzioni. Non è necessario cambiare cron già attivi.
Il formato archivio `mp3-backup` versione 1 e il formato CSV `mp3-tenant`
restano invariati, così come database, volumi, file salvati e chiavi delle
preferenze del browser. `DB_DATABASE=mp3` nel file di esempio è un identificativo
legacy, non il nome visualizzato del prodotto.

Non rinominare la cartella di un deployment esistente senza verificare il
progetto Compose e i suoi volumi. I riferimenti operativi `mp3-app` e
`/etc/cron.d/mp3-scheduler` qui documentati identificano l'ambiente esistente
e vanno conservati. Per checkout già presenti aggiornare il remote con:

```sh
git remote set-url origin https://github.com/Capobuf/obake.git
```

## Email della piattaforma

Gli amministratori della piattaforma possono aprire **Impostazioni Piattaforma → Email** e salvare
un unico SMTP per tutti gli ambienti. La configurazione si applica al mailer
standard Laravel, compresi verifica email e recupero password Fortify.
La modalità **Automatica / STARTTLS** usa `smtp` e negozia STARTTLS quando
supportato dal server; **SMTPS** usa TLS implicito. Username e password sono
facoltativi per server che non richiedono autenticazione.

La password è cifrata nel database con il cast nativo Laravel e non viene
restituita al frontend. Un campo password vuoto mantiene quella esistente,
anche al primo salvataggio se già presente nella configurazione Laravel.
Conservare `APP_KEY` insieme ai backup per poter decifrare le credenziali.
Il salvataggio non modifica `.env`; la configurazione applicativa prevale
su `MAIL_URL` e aggiorna i mailer risolti alle successive richieste d’invio.
Senza una configurazione salvata rimane attiva la configurazione Laravel.

La prova richiede un destinatario esplicito e una configurazione salvata,
avviene in modo sincrono e segnala l’accettazione del messaggio da parte del
trasporto SMTP, senza garantire il recapito. I mailer `log` e `array` non
recapitano email reali e non vengono usati per dichiarare riuscita la prova.
I test dedicati in `tests/Feature/PlatformEmailSettingsTest.php` simulano il
trasporto e non contattano server SMTP esterni.

### Template email HTML

Il test SMTP, gli inviti e le notifiche di accesso usano il layout Blade
condiviso `resources/views/mail/layouts/obake.blade.php`. Markup, tipografia e
PNG provengono dalla proposta V2 del commit
`cf65b3a9352570ddf1d80d2be4d895d2ca0c6bfb`, conservata nel branch
`issue-assets/email-templates-v2`. Gli asset sono in `public/branding/email`.
Le email includono anche una parte testuale, senza dipendenze esterne o CDN.

`GeneralNotification` gestisce titolo e contenuto dinamici, azione facoltativa
e organizzazione facoltativa. `UserInvitation` usa un’unica vista per inviti
piattaforma e organizzazione, mantenendo i token Fortify. Gli utenti esistenti
ricevono il link all’organizzazione, senza una nuova impostazione password.

Gli URL delle immagini usano `APP_URL`, oppure `ASSET_URL` se valorizzato.
In produzione impostare un URL pubblico HTTPS (per esempio
`APP_URL=https://app.dominio.it`), pubblicare gli asset e invalidare la cache
Laravel. I link operativi restano generati dalle rotte Laravel. Con un URL
locale, le immagini nelle caselle esterne non saranno raggiungibili.

I test `EmailTemplatesTest`, `PlatformEmailSettingsTest` e
`UserInvitationsTest` verificano rendering, escaping, parti HTML/testo e
integrazione senza SMTP reale. La resa nei client Gmail e Outlook richiede
anche una verifica nelle rispettive caselle: l’accettazione SMTP e l’anteprima
nel browser non certificano da sole il recapito o la compatibilità del client.

## Inviti e accesso agli ambienti

In **Impostazioni Piattaforma → Utenti**, super admin e amministratori della
piattaforma invitano nuovi amministratori tramite **Invita utente**, scegliendo
zero, uno o più ambienti. Il profilo Piattaforma accede alle impostazioni globali
(utenti, ambienti, email, backup e sync), ma consulta solo gli ambienti assegnati.
È un permesso forte: può modificare esplicitamente anche queste assegnazioni.
Solo `is_super_admin`, riservato al bootstrap/CLI, bypassa le associazioni tenant.

Ogni membro può gestire **Impostazioni ambiente → Utenti**, stati dei progetti
e importazione/esportazione del proprio ambiente. Questo invito crea un utente
aziendale con un solo ambiente e senza accesso Platform né selettore ambienti.
Un account aziendale già assegnato altrove o un amministratore Platform non può
essere riutilizzato da questo invito; il reinvito nello stesso ambiente non
invia una seconda email. La rimozione revoca solo l’associazione corrente.

Dalla riga utente in Platform si gestiscono gli ambienti (massimo uno per gli
aziendali), si conferma esplicitamente la promozione a Piattaforma, si blocca o
riattiva l’accesso e si elimina un account senza storico. Il blocco è distinto
dalla verifica email, revoca le sessioni database e impedisce password, 2FA,
passkey e sessioni già aperte. Reset password e assegnazioni non lo rimuovono.
Commenti, anche eliminati logicamente, storico undo o allegati con autore
impediscono la cancellazione, anche dal profilo personale. Super admin e
account corrente sono protetti dalle azioni distruttive di Platform.

La lista mostra lo stato **TOTP: attivo/non attivo**, senza segreti o codici.
Solo il super admin può usare **Disattiva MFA** su un altro utente non super
admin, anche quando la configurazione TOTP è ancora da confermare. La modale
richiede la password corrente del super admin a ogni operazione. Il reset usa
Fortify, revoca sessioni database e Ricordami e conserva lo stato dell’account.
L’utente può riconfigurare TOTP da **Impostazioni → Sicurezza**; le passkey
restano invariate. Non sono necessarie migration per questa funzione.

**Rollout:** applicare la migration `2026_10_23_000001_add_platform_access_to_users`.
Gli account esistenti restano abilitati e non ricevono nuovi privilegi. Controllare
il profilo nella pagina Utenti: gli account aziendali legacy con più ambienti
sono segnalati e non accedono ai tenant fino alla correzione esplicita delle
assegnazioni o alla promozione confermata. Anche gli account precedentemente
invitati globalmente richiedono una promozione esplicita se devono gestire Platform.
Il ripristino di backup aziendali rifiuta una seconda associazione aziendale;
non promuove utenti né rimuove associazioni automaticamente.

Il link di impostazione password usa `password_reset_tokens` e la scadenza del
broker configurato (normalmente 60 minuti). L’indirizzo diventa verificato solo
dopo un reset valido e completato, senza una seconda email di verifica.
Il recupero password ordinario resta disponibile anche per inviti scaduti o
invii falliti. Non sono aggiunte tabelle o stati di invito.

Gli invii sono sincroni. Se l’invio fallisce, il form mostra un errore e conserva
account e associazioni: una volta sistemata la configurazione email, il
destinatario può usare **Password dimenticata?**. I mailer `log` e `array`
(e i failover che li includono) non vengono considerati un invio reale;
`array` è ammesso soltanto nell’ambiente di test. I test inviti non contattano
SMTP esterni.

## Sviluppo locale senza Docker

Il comando ufficiale avvia i processi di sviluppo Laravel e Vite:

```powershell
composer run dev
```

In alternativa, avviare backend e frontend in due terminali:

```powershell
php artisan serve
npm run dev
```

L'applicazione è normalmente disponibile su `http://localhost:8000`.

## Controlli e build

```powershell
npm run check
npm run types:check
composer run test
npm run build
```

## Deployment da sorgente (solo per sviluppatori)

Per l'installazione su CloudPanel utilizzare preferibilmente lo ZIP descritto all'inizio del README. Se si distribuisce il repository sorgente, occorre installare le dipendenze con Composer e compilare `public/build` con `npm ci && npm run build` prima del deploy. In produzione non sono richiesti processi Node.js permanenti e Inertia SSR e disabilitato.

## Gestione spese

La tabella usa i componenti shadcn/ui già presenti, con selezione limitata alla
pagina corrente e cancellazione confermata dell’intera selezione in una
transazione. Filtri, ordinamento e paginazione restano gestiti da Laravel.

Le celle modificabili usano Invio per salvare ed Esc per annullare, senza
pulsanti di conferma o annullamento. Nelle combobox, un clic fuori dalla modifica
la chiude: se il valore è cambiato viene salvato, altrimenti viene annullata.
Un valore vuoto indica un importo da
inserire, distinto da zero. Dopo il salvataggio o la cancellazione vengono
ricaricati anche riepiloghi e grafici.

In tutta l’app, report/PDF e XLSX lo scostamento è la somma degli effettivi
meno la somma degli allocati nel perimetro selezionato, anche su spese distinte.
Scostamento positivo = rosso (senza `+`), negativo = verde, zero = neutro.
Una somma vuota vale zero solo nel calcolo dello scostamento: gli importi
mancanti restano null e non indicano un errore. Una voce con allocato presente
e nessun effettivo è segnalata come «Solo stima» con un triangolo grigio e tooltip.
Per progetti e contratti si considerano gli importi complessivi delle spese
attribuite nell’anno: previsione e acquisto possono essere su spese diverse.
Un effettivo pari a zero è registrato e non genera la segnalazione. Un insieme vuoto
ha scostamento zero e conteggio zero; un anno precedente assente resta assente.

Glide è stato rimosso: non sono più disponibili copia/incolla di intervalli e
modifica delle altre colonne nella griglia. Il riordino tramite trascinamento
è escluso perché non esiste un ordine manuale persistente e la lista è filtrata
e paginata sul server.

## Stati dei progetti

Gli stati si gestiscono in **Impostazioni ambiente → Stati dei progetti**, con
accesso per tutti i membri e configurazione separata per ambiente. È possibile
crearli, rinominarli ed eliminarli. Prima dell’eliminazione va scelto un altro
stato oppure **Nessuno stato**: l’operazione aggiorna i progetti e rimuove lo
stato nella stessa transazione. Gli stati iniziali e le assegnazioni esistenti
sono conservati dalla migration.

Lo stato si sceglie da una combobox con ricerca, anche nella tabella e nel
dettaglio del progetto. Gli editor delle tabelle usano **Invio** per salvare e
**Esc** per annullare, senza pulsanti ✓ e ×. Filtri, grafici e trasferimenti
CSV/XLSX utilizzano gli stati configurati.

## Commenti dei record

Spese, contratti, progetti e fornitori hanno una sezione **Commenti** nel
proprio dettaglio. Per i centri di costo usare **Commenti** nel menu della
riga: la sezione si apre in un pannello laterale. I commenti sono disponibili
dopo il salvataggio e appartengono al record, indipendentemente dall’anno.
Dal Budget si raggiungono tramite il collegamento al record originale.

La timeline raggruppa ogni commento principale con le proprie risposte,
limitate a un livello. **Rispondi** apre un editor inline; l’aeroplanino invia
nuovi messaggi e risposte, mentre le modifiche usano **Salva/Annulla**.
Tutti i membri possono leggere e inviare; soltanto l’autore può modificare
o eliminare il proprio messaggio, anche rispetto ai super admin.
Il conteggio nell’header include tutti i messaggi attivi. Il server pagina
10 thread principali per volta, ordinati per data di creazione e ID;
le risposte di ogni thread sono in ordine cronologico. Le modifiche non
cambiano posizione; **Modificato** segnala timestamp differenti.

Sono ammessi grassetto, corsivo, sottolineato, liste puntate/numerate e link
HTTP/HTTPS. Il server valida il JSON Tiptap: massimo 5.000 caratteri di testo,
64 KiB di JSON e limiti a profondità e numero di nodi. Il contenuto rimane
nella colonna `content` e i collegamenti nella colonna `parent_id` del
pacchetto `ryangjchandler/laravel-comments`. La visualizzazione usa il renderer
React statico di Tiptap, senza HTML arbitrario né un editor per ogni messaggio.

Eliminando un commento principale con risposte rimane **Commento eliminato**,
senza restituire autore o contenuto cancellati. Le risposte rimangono leggibili;
un thread cancellato senza risposte attive scompare. La cancellazione della
singola risposta la nasconde. Sono soft-delete indipendenti dall’Undo gestionale.
Eliminando il record i commenti rimangono conservati ma inaccessibili; tornano
visibili quando Undo ripristina lo stesso record. Il CSV non li include.

In **Impostazioni → Profilo** ciascun utente può caricare, sostituire o rimuovere
la propria foto JPG/PNG/WebP, fino a 2 MB, con verifica MIME server. Senza foto
compaiono le iniziali. Le foto sono sul disco privato `local`, sotto
`storage/app/private/profile-photos`; il percorso non viene esposto e la lettura
passa da una rotta autenticata. Sostituzione, rimozione e cancellazione del
profilo eliminano la vecchia foto. Includere questa directory nei backup;
non occorre un link pubblico allo storage. Gli URL relativi funzionano anche
accedendo all’app da un hostname diverso da `APP_URL`.

L’installazione richiede `composer install`, `npm ci`, `php artisan migrate`
(per commenti e colonna foto utente), `npm run build` e
`php artisan optimize:clear` nell’ambiente applicativo. I test dedicati sono
`CommentTest` e `Settings/ProfileUpdateTest`; usare un database separato.

## Allegati di contratti, spese e progetti

Le pagine di dettaglio e i pannelli laterali di modifica includono una sezione
Allegati condivisa: selezione multipla
(fino a 10 file), trascinamento, elenco, download ed eliminazione con conferma.
Ogni file viene caricato con una richiesta indipendente, senza retry automatici:
se un file fallisce, quelli completati rimangono salvati. La stessa selezione e i
file già completati nella sessione della sezione vengono deduplicati. In caso di
interruzione di rete, aggiornare l’elenco prima di riprovare.
Durante la creazione gli allegati diventano disponibili solo dopo il salvataggio;
dal pannello di modifica si gestiscono direttamente con la drop zone. I
salvataggi sono indipendenti dal form economico e dal suo pulsante Annulla.
Il pannello non si chiude durante un caricamento o un’eliminazione; quando viene
chiuso, il dettaglio viene aggiornato per mostrare le modifiche agli allegati.

Formati ammessi: PDF, JPG/JPEG, PNG, WEBP, DOCX, XLSX, CSV e TXT. Il server verifica
estensione e MIME del contenuto; i pacchetti Office con macro vengono respinti,
anche se rinominati. PDF e immagini possono essere aperti nel browser; gli altri
formati si scaricano. Questi controlli non costituiscono una scansione antivirus.

Il limite predefinito è **2 MB per file** (2 MiB, 2048 KiB). In
**Amministrazione → Generali → Allegati** si può salvare un limite globale per
contratti, spese e progetti di tutte le aziende. La UI usa MB (1 MB = 1024 KiB),
accetta valori da 1 KiB a 1024 MB e richiede una conversione esatta in KiB interi.
Il valore è salvato nel singleton `platform_settings` e vale dalla richiesta
successiva, senza riavvii o invalidazioni di cache; le pagine già aperte vanno
aggiornate per visualizzarlo. I file già caricati restano invariati.

Senza un valore nel database si usa `config/attachments.php`: la variabile
server `ATTACHMENTS_MAX_SIZE_KB` in `.env` personalizza questo fallback
(default: `2048`). La UI non scrive `.env`; soltanto le modifiche manuali al
fallback richiedono di rigenerare l’eventuale cache Laravel. Il frontend riceve
limiti ed estensioni dal server. Il backup globale include l’impostazione nel
dump DB; i backup tenant non la modificano. I limiti di backup e ripristino,
CSV/XLSX, loghi e avatar rimangono separati.

I contenuti sono sul disco Laravel privato `attachments`, sotto
`storage/app/private/attachments/{tenant_id}` con nomi casuali; il nome originale
è un metadato. Non creare link pubblici a questa directory. Download e anteprime
passano da endpoint autenticati, con verifica del tenant e del record proprietario,
header `nosniff` e cache privata senza memorizzazione. Il disco non offre URL
pubblici o temporanei serviti da Laravel. I percorsi interni non vengono inviati
al frontend. `storage/app/private/.gitignore` esclude i documenti da Git.

L’utente del processo PHP (in Sail: `sail`) deve poter leggere e scrivere questa
directory, oltre a `storage` e `bootstrap/cache`; evitare permessi globali `777`.
PHP deve consentire `upload_max_filesize` almeno pari al limite effettivo e un
`post_max_size` superiore per l’overhead multipart, con `file_uploads=On`
(per il default: almeno `2M` e, per esempio, `3M`). La UI non modifica questi
parametri: PHP, il webserver o il provider possono imporre un limite inferiore
a quello salvato. Per ripristinare ZIP di backup servono limiti adeguati allo ZIP,
indipendentemente dalla soglia degli allegati. Ogni richiesta contiene
un solo file, perciò non è richiesto un limite POST di 200 MB. Verificare anche
limiti e timeout di eventuali proxy/web server. Sail usa `artisan serve` e il
proprio `php.ini` configura entrambi i limiti a `100M`; non è necessario modificarli.
Le estensioni PHP `fileinfo` e `zip`, già presenti in Sail, sono necessarie per i
controlli di contenuto e dei pacchetti Office.

Il bind mount `.:/var/www/html` di `compose.yaml` conserva i file sul filesystem
host quando il container viene ricreato. In produzione usare un volume persistente
o una directory condivisa tra release: non sostituire o cancellare lo storage
privato durante gli aggiornamenti. Includere **database e storage privato** nello
stesso piano di backup. Per ripristini coerenti, bloccare temporaneamente le
scritture e ripristinare entrambi da uno stesso punto temporale, verificando
l’esistenza dei file referenziati prima di riaprire gli upload.

La cancellazione del singolo allegato o del proprietario rimuove i metadati nella
transazione e i contenuti fisici solo dopo il commit esterno, anche per la
cancellazione multipla delle spese. Un rollback mantiene disponibili i file.
I contratti/progetti con spese collegate restano protetti dalla cancellazione.
Usare questi flussi applicativi anche per eventuali strumenti futuri: cancellazioni
SQL dirette e cascade del tenant rimuovono i metadati ma non attivano il servizio
di pulizia. Non è prevista una cancellazione del tenant nell’interfaccia attuale.

Se la pulizia fisica fallisce dopo il commit, l’interfaccia segnala la rimozione
incompleta senza dichiarare il pieno successo; il database resta coerente. I log
Laravel contengono disco e percorso da controllare e rimuovere tramite Storage.
Non sono introdotti worker o retry automatici. I file mancanti restituiscono un
404 controllato; i metadati possono comunque essere eliminati.

I test dedicati sono in `tests/Feature/AttachmentTest.php` e `tests/Feature/UndoTest.php`,
usano il database separato `testing`, storage simulato e fixture Office/PDF valide.
Usano `DatabaseTruncation` per osservare commit reali, con pulizia anche a fine test
per non lasciare dati ai casi successivi con `RefreshDatabase`. Prima di eseguire la suite,
verificare `DB_DATABASE=testing`, `DB_URL` vuoto e assenza di cache che punti al
database di sviluppo. Non eseguire reset o `migrate:fresh` sul database utente.
Il ramo di partenza non contiene workflow GitHub Actions: i controlli elencati
sopra si eseguono localmente, senza introdurre infrastruttura CI.

### Verifiche dell’implementazione (10 ottobre 2026)

- `php artisan migrate`: migration applicata in Sail; nessuna migration pendente
  al controllo successivo. È stata applicata anche la migration preesistente
  `2026_10_10_000000_remove_dates_from_expenses_table`, già pendente nell’ambiente.
- `composer run test` (comprende `php artisan test`, Pint e PHPStan): **115 test
  passati, 1991 asserzioni**, con database MySQL `testing` verificato effettivamente
  tramite `SELECT DATABASE()`, `DB_URL` vuoto e configurazione non in cache.
- `npm run check`, `npm run types:check`, `npm run build`: superati. La build
  segnala un chunk applicativo superiore a 500 KB; non impedisce la compilazione.
- Browser con CSRF attivo nello stesso container, su database SQLite e storage
  temporanei separati: verificate tutte e tre le pagine, selezione multipla,
  trascinamento, deduplicazione, errore parziale, limite di 10 file, upload reale
  di 20 MB, rifiuto oltre il limite, logout/login, download con byte identici,
  anteprima PDF con header privati, conferma di eliminazione e pulizia dei file
  alla cancellazione dei proprietari. Verificate visualizzazione desktop/light
  e mobile/dark senza overflow; nessun errore JavaScript dell’applicazione.
  Istanza e dati temporanei rimossi al termine.

## Scadenzario e promemoria contratti

**Contratti → Scadenzario** mostra i contratti dell’anno economico selezionato,
compresi quelli con fine negli anni successivi e i record legacy senza annualità.
La timeline continua fino all’ultima fine effettiva; i contratti senza fine restano
nell’elenco senza una durata inventata. La Panoramica riutilizza la stessa timeline
e mostra gli stessi contratti dell’anno, indipendentemente dai filtri delle spese.
La rotellina regola lo zoom, il trascinamento sposta il periodo e il doppio clic
sullo sfondo ripristina la vista iniziale. Per l’anno corrente, la timeline parte
da un mese prima di oggi e mostra almeno tre mesi futuri; il passato resta
esplorabile. Il conteggio dei contratti senza scadenza apre l’elenco filtrato.

In **Impostazioni ambiente → Promemoria contratti** ogni utente dell’ambiente può
configurare notifiche condivise, disabilitate per default. Sono notificabili solo
contratti con `year` uguale all’anno di `ends_on`: nessuna copia annuale automatica.
Il combobox propone anticipi di 1/3/7/14/30 giorni e permette di aggiungere
valori personalizzati interi da 1 a 3650 giorni, visualizzati come chips rimovibili.
Gli anticipi vengono aggregati per giornata e destinatario;
il riepilogo mensile copre dal giorno scelto al giorno precedente il successivo
invio. La preview usa lo stesso calendario del comando, sui dati del form e su un
orizzonte di 12 mesi, senza salvare né spedire.

L’invio è fissato alle **08:00 Europe/Rome**, anche quando il resto dell’app usa
UTC, con retry automatici ogni ora fino alle **23:00** per gli invii falliti.
I cambi ora legale sono gestiti dal fuso; non si recuperano giorni trascorsi.
Un salvataggio rende effettive le nuove regole da quel momento, senza recuperare
le soglie già superate; restano ritentabili le notifiche del giorno già tentate
e fallite per quel destinatario. Il comando usa l’SMTP della piattaforma e rifiuta trasporti
`log`/`array` o fallback: configurare anche `APP_URL` con l’URL raggiungibile dai
destinatari. Ogni destinatario riceve una email separata.

In produzione è necessario eseguire Laravel Scheduler **ogni minuto**, per
esempio con questo cron sull’host (adattare il percorso del deployment):

```cron
* * * * * cd /percorso/obake && docker compose exec -T laravel.test php artisan schedule:run >> /var/log/obake-scheduler.log 2>&1
```

Per installazioni senza Compose, usare il nome reale del container, ad esempio
`docker exec obake-app php artisan schedule:run`. Verificare il cron dell’host:
registrare il comando in `routes/console.php` da solo non avvia lo scheduler.
Non sono necessari worker, broker o nuovi container. `php artisan schedule:list`
mostra la pianificazione. Il comando `php artisan contracts:remind` permette un
retry nello stesso giorno, dalle 08:00, senza reinviare i successi già registrati.

Il registro `contract_reminder_deliveries` ha una chiave univoca per tenant,
indirizzo normalizzato e regola. La prenotazione persistente, serializzata con un
lock di riga, impedisce duplicati fra esecuzioni concorrenti o dopo riavvio.
`sent` indica accettazione da parte dell’SMTP, non consegna nella casella finale;
`failed` consente retry e gli errori sono nei log Laravel. Un arresto durante
l’invio può lasciare `pending`: viene segnalato nell’anteprima e non viene
reinviato automaticamente. SMTP e database non hanno una transazione comune:
l’amministratore deve verificare i log SMTP e riconciliare solo le righe incerte
come `sent` (con data) oppure `failed` (solo se non inviate), prima di un retry.
Non eliminare il registro per cambiare le impostazioni.

Verifica mirata, con stop al primo errore:

```sh
php artisan test --filter=ContractScheduleTest --stop-on-failure
```

## Backup locali e ripristino

**Impostazioni Piattaforma → Backup** è riservato agli amministratori della piattaforma. Crea uno ZIP
con il database MySQL completo, `storage/app/private` (allegati, foto e copie
Undo), storage pubblico, codice, asset compilati, lockfile, configurazione e
`.env`, inclusa `APP_KEY`. Non richiede Google Drive. Gli archivi sono in
`storage/app/backups/platform`, fuori dai dischi pubblici e dal disco `local`
che offre URL temporanei. Il download passa sempre da una rotta autenticata.
Sono dati altamente sensibili: non pubblicare la directory e conserva anche
le copie scaricate in un luogo protetto. Lo ZIP non ha una password separata.

L’elenco permette di eliminare un archivio o selezionarne più di uno, anche tutti.
La conferma mostra i nomi e avvisa che la cancellazione è definitiva, comprese
le ultime copie disponibili. Vale sia per piattaforma sia per tenant, con gli
stessi permessi del download; i dati attuali dell’applicazione non vengono eliminati.

Spatie Laravel Backup **v10 richiede PHP 8.4**; Compose e CI usano questa
versione. Sono necessari `zip`, `mysqldump` e, per ripristinare, il client
`mysql` (presenti in Sail). Dopo l’aggiornamento installare i lockfile, applicare
la migration delle impostazioni backup, compilare gli asset e pulire le cache.
Il database e i volumi esistenti vanno conservati.

```sh
docker compose up -d --build laravel.test
docker compose exec laravel.test composer install --no-interaction
docker compose exec laravel.test npm ci
docker compose exec laravel.test php artisan migrate --force
docker compose exec laravel.test npm run build
docker compose exec laravel.test php artisan optimize:clear
```

La programmazione globale è inizialmente **disabilitata**; si possono scegliere
giornaliera o settimanale, giorno e orario **Europe/Rome**. Lo Scheduler controlla
la scadenza ogni minuto e impedisce due esecuzioni dello stesso slot, compreso
il ritorno all’ora solare. Come per qualsiasi schedule Laravel, il server deve
eseguire `php artisan schedule:run` ogni minuto. Esempio di crontab con Sail:

```cron
* * * * * cd /percorso/obake && docker compose exec -T laravel.test php artisan schedule:run >> storage/logs/scheduler.log 2>&1
```

Nell’ambiente attuale `10.0.0.30:8000` i container sono autonomi: usare
`docker exec mp3-app` al posto di `docker compose exec laravel.test`.
Non avviare un secondo progetto Compose sugli stessi dati. Il runtime del
container applicativo è stato aggiornato a PHP 8.4; per una futura ricreazione
utilizzare il runtime Sail 8.4 indicato nel repository.

Il comando operativo è `php artisan obake:backup`. Usa Spatie per dump e ZIP,
verifica il manifest e ogni file con SHA-256, poi pubblica l’archivio nell’elenco
e applica la **DefaultStrategy Spatie**. La politica standard conserva tutti
gli archivi per 7 giorni, poi copie giornaliere per 16 giorni, settimanali per
8 settimane, mensili per 4 mesi e annuali per 2 anni; soglia di 5 GB per ambito,
con conservazione dell’archivio più recente. Si configura in `config/backup.php`
secondo Spatie. La stessa strategia vale per gli ZIP tenant. I comandi Spatie
`backup:run` lavorano nella directory di staging `.pending`: usare `obake:backup`
per ottenere archivi verificati e visibili nell’applicazione.

La schermata conserva ultimo avvio, esito ed errore sanitizzato, senza dump,
SQL o credenziali nei log. Un errore di rotazione segnala un esito fallito anche
se il nuovo ZIP, già verificato, è disponibile. Directory mancanti, file
illeggibili, allegati incompleti, schema incompatibile e spazio insufficiente
interrompono l’operazione. Cache, log, dipendenze ricostruibili, file temporanei
e backup stessi sono esclusi. Un backup interrotto non viene pubblicato.

Le scritture web e i comandi periodici di promemoria/Undo condividono un lock
locale; backup e ripristino acquisiscono il lock esclusivo. I salvataggi durante
l’operazione ricevono un errore temporaneo e possono essere ripetuti. Prima di
un backup globale sospendere anche import SQL, deploy e scritture CLI esterne
all’applicazione. Questa soluzione è per la singola installazione locale con
storage condiviso del repository; storage remoti o più host richiedono un piano
di snapshot dedicato. Non sono stati aggiunti container, code o worker.

### Backup di un ambiente

**Impostazioni ambiente → Backup** è accessibile agli stessi membri che oggi
possono gestire l’ambiente. Lo ZIP versionato contiene snapshot dei dati di tutti
gli anni, riferimenti annuali, Budget, stati, impostazioni dei promemoria,
cronologia delle notifiche, commenti con risposte, allegati e metadati,
identità degli utenti e associazioni. Riutilizza lo snapshot relazionale
esistente e il controllo di ambiente vuoto di `TenantCsvTransfer`; non usa il
CSV tecnico come backup e non ricalcola importi o riapplica le validazioni
per nuovi record. La cronologia temporanea Undo rimane nel backup globale.

Il backup tenant include anche il logo aziendale: `tenant.logo_path` in
`data.json` dichiara il riferimento originale oppure `null`; quando presente,
la sola entry `logo` è obbligatoria e verificata dall’inventario del manifest.
Negli archivi precedenti l’assenza del metadato significa assenza del logo.
Un logo dichiarato ma mancante, alterato o non valido blocca il ripristino.
Si applicano gli stessi limiti del caricamento: PNG/JPEG, 2 MB, 4096×4096 pixel.
Il ripristino genera un percorso privato nuovo nel tenant di destinazione;
un logo già presente nella destinazione impedisce la sovrascrittura.

Il ripristino web richiede uno ZIP compatibile e una conferma esplicita. Il
tenant di destinazione deve essere privo di dati, cronologia Undo/promemoria e
impostazioni personalizzate; gli stati iniziali predefiniti sono ammessi.
Il nome e lo slug della destinazione restano invariati. Le associazioni già
presenti devono essere comprese in quelle del backup: non si effettua un merge.
File e riferimenti vengono verificati prima di inserire dati, le chiavi vengono
rimappate e gli errori annullano la transazione e rimuovono i nuovi file.

Il backup tenant **non contiene password, passkey, segreti 2FA, sessioni o
privilegi globali**. Nella stessa installazione un’identità esistente viene
riutilizzata solo se ID, nome ed email coincidono e la firma HMAC del backup è
valida; l’account non viene aggiornato. Su un’altra installazione qualsiasi
email già esistente per una membership è un conflitto che blocca il ripristino.
Solo le membership importate da un’altra installazione possono creare account
non privilegiati, non verificati e con password casuale:
si accede attraverso il recupero password Fortify. Altri tenant e account
condivisi restano invariati. Una rotazione di `APP_KEY` rende l’archivio tenant
un archivio proveniente da un’altra installazione ai fini del riuso identità.

L’eliminazione da **Amministrazione → Utenti** o dal proprio **Profilo** rimuove
fisicamente l’account, credenziali, sessioni database, accessi e cronologia Undo
personale. Commenti (anche risposte e cestinati), documenti e dati aziendali
restano: si conserva l’ultimo nome come testo, senza ID dell’account. Nei
commenti visibili appare «Nome (eliminato)»; gli orfani senza nome storico
mostrano «Utente non disponibile». Sono scartati anche gli Undo di altri utenti
che potrebbero ripristinare il vecchio caricatore; gli altri conservano i
controlli di integrità e possono restituire 409 dopo la modifica. Una nuova
registrazione con la stessa email non eredita attribuzioni o accessi.
La rimozione di un utente dalla singola azienda continua a revocare solo
quell’accesso. Super admin e autoeliminazione da Amministrazione sono protetti.

I nuovi ZIP tenant conservano `comments.author_name` e
`attachments.uploaded_by_name`. Il ripristino accetta archivi precedenti privi
solo di questi due nuovi campi; i soli autori/caricatori storici non generano
account. Nella stessa installazione una membership per un ID ormai assente
blocca il ripristino con rollback, anche se l’email è stata riutilizzata.
Negli archivi precedenti i riferimenti puramente storici diventano nomi testuali
quando l’identità originale non è più disponibile.

L’ID viene rimosso dai destinatari dei promemoria. Gli indirizzi configurati
separatamente come destinatari esterni e lo storico delle consegne restano:
un indirizzo esterno può quindi continuare a ricevere promemoria. ZIP locali,
copie Google Drive e backup globali precedenti non vengono riscritti; un
ripristino globale riporta anche gli account allo stato del backup. Conservare
nomi, email storiche e vecchi backup è deliberato: questa funzione gestisce
l’uscita dell’utente dall’applicazione, non una cancellazione GDPR integrale.
Se la pulizia di avatar o file temporanei Undo fallisce dopo il commit,
l’account resta eliminato: l’interfaccia avvisa e i percorsi da pulire sono
registrati nel log.

I limiti di upload e decompressione sono in `config/platform-backups.php`;
anche i limiti PHP e del proxy devono consentire il caricamento. Per impostazione
iniziale lo ZIP caricato non può superare 100 MB, i metadati JSON 64 MB, il
contenuto estratto 10 GB e le voci ZIP 100.000. Gli archivi globali si ripristinano
da filesystem senza upload web. I checksum rilevano corruzioni; importare
archivi provenienti da installazioni affidabili.

### Ripristino globale da terminale

1. Preparare una destinazione con **database MySQL completamente vuoto**,
   stessa versione principale MySQL, PHP 8.4 e storage privato/pubblico vuoto
   (sono ammessi i `.gitignore`). Configurare `.env` con le credenziali della
   destinazione. Non eseguire le migration prima del ripristino.
2. Installare esattamente codice, configurazione e asset del backup, con le
   dipendenze dei lockfile. Il manifest registra commit, impronta delle migration,
   dimensioni e SHA-256 dei file. Il comando confronta anche il codice installato,
   per rilevare differenze rispetto al commit dichiarato, compresi file modificati
   non ancora committati.
3. Copiare lo ZIP in un percorso privato e verificare:

    ```sh
    php artisan obake:restore /percorso/backup.zip --verify
    php artisan down
    php artisan obake:restore /percorso/backup.zip --force
    ```

4. Il comando importa il dump, ripristina lo storage e `.env`/`APP_KEY`, mantenendo
   **connessione DB e APP_URL della destinazione**. Conserva il precedente `.env`
   in `.env.before-restore`, con permessi privati. Se la configurazione del processo
   o dell’orchestratore sovrascrive `.env`, allinearla prima di riaprire l’applicazione.
5. In un nuovo processo eseguire `php artisan optimize:clear`, controllare utenti,
   impostazioni cifrate e allegati, quindi `php artisan up`. Custodire o rimuovere
   in modo sicuro `.env.before-restore` dopo il collaudo.

Non è possibile ripristinare sopra un database popolato. L’import MySQL contiene
DDL e non è transazionale: se il client o il filesystem fallisce dopo l’avvio,
il comando restituisce errore e mantiene la destinazione in manutenzione.
In tal caso ripartire da una nuova destinazione vuota, conservando l’archivio
originale. Nessun ripristino globale è esposto via HTTP.

### Collaudo della issue 21

Il 18 ottobre 2026 è stato eseguito un backup/ripristino MySQL 8.4 reale su due
database temporanei, con directory applicative separate nel container esistente.
Verificati: database di destinazione corretto, utenti e privilegi, associazioni,
impostazioni tenant, importi, byte degli allegati e dello storage privato,
uguaglianza di `APP_KEY` e decifratura delle credenziali SMTP. Il comando di
verifica non ha scritto dati; il restore ha mantenuto la manutenzione fino
all’apertura esplicita. Database e fixture temporanei sono stati rimossi al
termine. Questo collaudo completo non viene aggiunto alla CI.

Verificati anche dal browser: creazione/download di entrambi gli ZIP,
salvataggio della pianificazione, restore tenant vuoto e pagina mobile.
La suite MySQL completa passa con 347 test e 7.623 asserzioni; passano anche
build, TypeScript, lint, Pint e PHPStan.

`tests/Feature/BackupTest.php` copre round-trip tenant, isolamento, permessi,
identità in conflitto, firma, schema, ZIP alterati/traversal, file mancanti,
rollback con pulizia file, pianificazione e rotazione. Controlli rapidi:

```sh
php artisan test --filter=BackupTest --stop-on-error --stop-on-failure
```

Per l’intera suite usare il database separato `testing`, mai quello operativo:
`php artisan test --stop-on-error --stop-on-failure`.

## Google Drive: report annuali e copia dei backup

**Impostazioni Piattaforma → Sync** collega un solo account Google tramite
`google/apiclient` con lo scope `drive.file`. Solo gli amministratori della piattaforma collegano o
scollegano l’account e abilitano gli ambienti. I membri di ogni ambiente possono
consultarne lo stato e avviare **Sincronizza ora**, con gli stessi permessi delle
altre impostazioni ambiente. Non sono presenti OAuth o override per tenant.

### Configurazione OAuth

1. In Google Cloud abilitare Google Drive API, configurare la schermata di
   consenso e creare credenziali OAuth di tipo **Applicazione web**.
2. Inserire **Client ID** e **Client Secret** nella pagina Sync e salvare. Il
   secret è cifrato nel database e non viene restituito alla UI. Un campo vuoto
   mantiene il secret salvato; un nuovo Client ID richiede il suo secret. Le
   variabili server `GOOGLE_DRIVE_CLIENT_ID` e `GOOGLE_DRIVE_CLIENT_SECRET`
   restano disponibili come configurazione iniziale, finché non si salva dalla UI.
   Cambiare credenziali scollega Google e richiede un nuovo consenso; i file
   remoti e le associazioni degli ID restano conservati.
3. Copiare con il pulsante accanto a **URL di callback** e autorizzare
   esattamente quell’URI in Google Cloud. Il valore predefinito
   è `APP_URL/platform/settings/sync/callback`; `GOOGLE_DRIVE_REDIRECT_URI`
   consente di specificare l’URL effettivo dietro un proxy. La pagina e il
   callback devono condividere la sessione autenticata dell’amministratore della piattaforma.
4. Pubblicare l’applicazione su un hostname HTTPS per collegare Google:
   `http://10.0.0.30:8000` non è un redirect OAuth valido. Google ammette HTTP
   soltanto per localhost/loopback, con le eccezioni descritte nelle
   [regole ufficiali per gli URI OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).
5. Invalidare la cache Laravel, aprire **Sync → Collega Google** e concedere
   l’accesso offline all’account centrale. Un’app OAuth esterna lasciata in
   modalità Testing può avere refresh token con scadenza di sette giorni;
   verificare lo stato di pubblicazione secondo la
   [documentazione Google sui token](https://developers.google.com/identity/protocols/oauth2#expiration).

Access token e refresh token sono cifrati nel database con il cast Laravel,
non restituiti al frontend. Conservare `APP_KEY` per decifrarli. Lo state OAuth
è monouso e scade dopo dieci minuti. Disconnettere elimina le credenziali locali,
senza revocare o cancellare file remoti. Ricollegare lo stesso account conserva
le associazioni; un account diverso riceve cartelle proprie e azzera gli esiti
precedenti mostrati per gli ambienti. Le associazioni del vecchio account sono
conservate per un eventuale ricollegamento.

### Report di consultazione

Le configurazioni Drive esistenti riutilizzano gli ID in `drive_objects`:
una cartella già chiamata `MP3` mantiene nome, posizione e contenuti.
Il rebranding non la rinomina e non crea una cartella sostitutiva. I nomi
`Obake` e `Obake/Backup globali` descrivono le nuove configurazioni; per quelle
legacy si applicano alla cartella già collegata.

Per nuove configurazioni Obake crea una cartella `Obake` in Il mio Drive e, alla prima sincronizzazione di ogni ambiente
abilitato, una cartella `Nome ambiente (ID)`. Gli anni derivano esclusivamente da
spese, righe economiche e annualità Budget effettivamente presenti: non dipendono
dall’anno selezionato nell’interfaccia. Un ambiente senza anni crea la propria
cartella senza inventare un file annuale.

Ogni `AAAA.xlsx` contiene **Spese, Righe economiche, Contratti, Progetti, Budget**.
Spese, righe e Budget sono limitati all’anno; contratti e progetti comprendono
l’anagrafica completa dell’ambiente. I report riutilizzano `SectionSpreadsheet`,
`SectionWorkbook`, `ReportSheet` e le query economiche correnti, mantenendo la
distinzione tra importi mancanti e zero. Non sono backup o modelli di import.
Le modifiche su Drive non rientrano in Obake e possono essere sovrascritte.

Dopo il collegamento, **Cartella di destinazione → Scegli cartella** apre il
selettore ufficiale Google. La scelta sposta l’intera cartella `Obake`, inclusi
report e backup esistenti, nella cartella selezionata mantenendo gli ID. La
scelta è conservata separatamente per account Google; ricollegare lo stesso
account la mantiene. Le sincronizzazioni successive verificano la destinazione
salvata e segnalano cartelle mancanti o senza permessi, senza usare altri percorsi.
Google non consente lo spostamento di questa cartella da Il mio Drive a un Drive
condiviso tramite API: in quel caso viene mostrato un errore.

In **Configurazione selettore Google** inserire la Browser API key e il numero
numerico del progetto Google Cloud, nello stesso progetto delle credenziali
OAuth, e abilitare Google Picker API. Non si ricava il numero dal Client ID.
La chiave è destinata all’uso nel browser: limitarla a Google Picker API e agli
origin consentiti secondo la [guida Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker).
Il selettore riutilizza l’access token centrale con scope `drive.file`:
non aggiunge un secondo login o permessi globali su Drive. Solo l’amministratore della piattaforma
riceve temporaneamente l’access token, da una risposta privata non memorizzabile
in cache; refresh token e Client Secret restano sul server.

Gli ID Drive vengono registrati prima delle scritture remote. I caricamenti
successivi aggiornano lo stesso ID, anche ripetendo un tentativo interrotto;
una cartella/file già creato e poi eliminato, spostato o cestinato produce un
errore esplicito, senza creare copie sostitutive. Ripristinare l’oggetto nella
cartella assegnata e riprovare. Nessuna sincronizzazione cancella file remoti,
anche quando un anno non è più presente nei dati locali.

Il comando `php artisan obake:drive-sync` sincronizza tutti gli ambienti abilitati,
continua sugli altri se uno fallisce e restituisce errore se almeno uno non è
completato. Laravel Scheduler lo avvia ogni giorno alle **03:00 Europe/Rome**.
Il server deve eseguire il consueto `php artisan schedule:run` ogni minuto;
nell’ambiente attuale `/etc/cron.d/mp3-scheduler` esegue già il comando in
`mp3-app`, senza Compose o nuovi processi. Le operazioni sono sincrone e usano
un lock locale condiviso tra CLI e web, compatibile con il lock dei backup.
Non sono supportate installazioni su host multipli con filesystem separati.

Stato, ultimo tentativo, ultimo successo ed errore sono consultabili da Sync.
Gli errori SDK vengono ridotti a fase e codice HTTP per non esporre token o
corpi delle richieste. Una terminazione forzata può lasciare lo stato “in corso”:
ripetere manualmente l’operazione riutilizza gli ID salvati. Gli upload usano
il protocollo resumable e verificano il checksum del file completato.

### Copia facoltativa degli archivi globali

In **Impostazioni Piattaforma → Backup**, abilitare **Copia i nuovi backup globali
su Google Drive** e salvare. La copia parte dopo creazione, verifica e rotazione
locale dell’archivio, nella sottocartella `Obake/Backup globali`. Gli archivi già
presenti possono essere copiati o ritentati con **Copia su Drive**, senza
rigenerarli. Il caricamento legge il file a blocchi e non mantiene l’intero ZIP
in memoria.

L’esito locale e quello remoto restano separati nella pagina e nel comando di
backup. Un upload fallito conserva l’archivio locale valido e registra l’errore
remoto. Disabilitare la copia o scollegare Google non impedisce i backup locali.
La rotazione locale non elimina le copie remote. Gli ZIP globali contengono
anche configurazione e chiavi segrete: l’account centrale deve essere adatto a
custodirli. Non viene aggiunto alcun ripristino o politica di retention remota.
Gli identificativi Drive restano configurazione dell’installazione e non
vengono trasferiti con il backup di un singolo tenant.

I test di `DriveSyncTest` simulano le risposte HTTP Google usando il client
ufficiale; coprono annualità, isolamento, null/zero, permessi, OAuth, token,
aggiornamento per ID, interruzioni, cartelle mancanti e backup locale/remoto.
Per eseguirli usare il database separato `testing`:

```sh
php artisan test --filter='DriveSyncTest|SpreadsheetTransferTest|BackupTest' --stop-on-error --stop-on-failure
```

La prova con un account Google reale richiede credenziali OAuth e consenso
interattivo; i test automatici non li sostituiscono.

## Prototipo di stampa Budget (issue #29)

Nel Budget, il menu **Importa, esporta e stampa** in alto a destra contiene
**Importa Excel**, **Esporta Excel** e **Stampa report**. Quest’ultimo apre il
configuratore con anteprima del documento.
Usa tutte le righe risultanti dai filtri della tabella, anche nei gruppi chiusi,
e l’ordinamento corrente; la selezione delle caselle di riga non limita il report.
KPI, ripartizione e subtotali provengono dallo snapshot Budget esistente. I grafici
usano esclusivamente le voci incluse nel Budget filtrato e gli importi già attribuiti,
senza ricalcolare le spese sottostanti. Il Sankey mostra allocato, effettivo o entrambi;
la tabella di riconciliazione è un blocco indipendente.

Il configuratore permette di modificare titolo, nome azienda, sottotitolo e titoli
dei blocchi; nascondere anno, logo, data, filtri/conteggi; riordinare e selezionare
blocchi e colonne. Il formato iniziale è A4 verticale. Tutto è attivo inizialmente
tranne la colonna Stato e la numerazione delle pagine. Titolo, reset e opzioni sono accanto al rispettivo blocco;
disattivandolo si nascondono le sue opzioni. La data nel Footer è automatica, rilevata
all’apertura del report, e può essere mostrata o nascosta. Il Footer contiene
data a sinistra e logo Obake centrato ed è ripetuto in fondo a ogni pagina, sia in stampa sia
nel PDF scaricato; uno spazio riservato lo separa dal contenuto. L’anteprima
continua lo mostra in fondo al documento. **Numeri di pagina** aggiunge i numeri
in basso a destra. Disattivando **Includi la prima pagina**, il primo foglio resta
senza numero e il secondo parte da 1. La stampa usa i contatori CSS nei margini
di pagina (supportati da Chromium 131+); il PDF scaricato include direttamente
i numeri, indipendentemente dal supporto di stampa del browser. La tabella
può raggruppare per tipo con subtotali facoltativi, rispettando l’ordine delle voci
all’interno dei gruppi. Ogni sezione del configuratore ha un reset indipendente.
Le opzioni seguono l’ordine del documento e sono raccolte in pannelli
richiudibili, inizialmente chiusi, anche per i singoli blocchi. I pulsanti con
l’occhio mostrano o nascondono gli elementi e portano l’anteprima alla zona
interessata, mantenendo il focus sul comando.
Le impostazioni valgono per il report aperto. I grafici aggiuntivi sono Distribuzione Fornitore (barre di allocato/effettivo),
confronto per progetti/contratti e scostamenti.
Le classifiche mostrano le prime 10 voci più «Altri»; gli scostamenti mostrano
fino a 5 scostamenti positivi e 5 negativi, come nella panoramica.
Non vengono caricati storico, stati dei progetti o scadenze dalla panoramica.

## Stampa di contratti, progetti e spese

**Stampa report** è disponibile nel menu di esportazione delle tre liste e delle
schede di contratti e progetti; nella scheda di una spesa è un pulsante dedicato.
Il report recupera tutte le righe filtrate nell’ordinamento corrente, oltre la
pagina visibile. Dalla scheda recupera soltanto l’elemento aperto.

Il configuratore, l’intestazione, il footer e il download PDF sono condivisi con
il Budget. L’elenco, il riepilogo e, per contratti/progetti, **Spese collegate**
sono inizialmente visibili. L’utente può nasconderli e attivare **Dettagli**,
che aggiunge anche note e condizioni delle spese collegate visibili. Le colonne
dell’elenco sono selezionabili e riordinabili. I totali riguardano le spese
dell’esercizio selezionato; le condizioni di altri anni non vengono incluse.
Gli elementi storici senza anno restano visibili come nelle liste e sono
indicati come **Non classificato**.

## Formato e verifiche dei report

Il logo si carica in **Impostazioni ambiente → Identità azienda** (PNG/JPG,
2 MB, massimo 4096 × 4096 pixel). È conservato sul disco privato esistente e
accessibile soltanto agli utenti del tenant o ai super admin. Dopo averlo modificato,
ricaricare il Budget prima di aprire un nuovo report.
Il report usa lo stesso font di sistema dell’applicazione: la famiglia effettiva
può variare tra sistemi operativi. La palette resta chiara anche con il tema dark.

**Scarica PDF** genera e scarica direttamente un PDF composto da immagini tramite
`html2pdf.js`, con A4 verticale/orizzontale e le opzioni del report corrente.
Il testo del file non è selezionabile; la tabella non ripete l’intestazione su
ogni pagina. L’override `html2canvas-pro` supporta i colori CSS usati da Tailwind 4.
Il generatore viene caricato solo al clic. I report troppo lunghi per il canvas
vengono bloccati con un messaggio: restringere i filtri oppure usare **Stampa**.
Nel Budget i titoli restano uniti al primo grafico o gruppo di voci. Un gruppo
di tabella più alto dell’area utile A4 inizia su una pagina nuova nel download;
le sue righe proseguono sulle pagine successive senza ripetere l’intestazione.

**Stampa** apre la stampa del browser tramite `react-to-print`:
in Chrome scegliere **Salva come PDF**, carta A4, scala 100% e controllare tutte
le pagine. L’anteprima nell’app mostra il documento continuo; quella di Chrome
mostra l’impaginazione effettiva. Le impostazioni del browser possono prevalere
su formato e margini CSS.
La stampa nativa ripete invece le intestazioni delle tabelle multipagina.

Controlli del prototipo, con database PHP separato `testing`:

```bash
npx vp test --bail=1
npm run check
npm run types:check
npm run build
php artisan test --filter='SectionReportTest|AnnualBudgetTest|TenantIdentityTest|SpreadsheetTransferTest|EconomicYearContextTest' --stop-on-error --stop-on-failure
```

Prima dell’approvazione verificare nell’app: filtri singoli e combinati, zero/una/
molte righe, colonne nascoste e riordinate, descrizioni lunghe, due anni, logo sì/no,
A4 verticale/orizzontale e tema light/dark. Confrontare i totali e controllare nel
PDF grafico titoli e righe complete; nella stampa nativa verificare anche le
intestazioni ripetute su tutte le pagine della tabella.

### Lingua italiana

Le nuove installazioni usano `APP_LOCALE=it` e `APP_FALLBACK_LOCALE=it`.
Per un'installazione esistente, impostare entrambe le variabili nel `.env` attivo;
con CloudPanel aggiornare anche `~/.dploy/overlays/.env`, conservando tutti gli altri
valori e i permessi `600`. Dopo il rilascio che include `lang/it`, eseguire
`php artisan optimize:clear` e `php artisan optimize` dalla release attiva, usando
il binario PHP configurato per quel sito. Nel container Sail usare
`docker compose exec laravel.test php artisan optimize:clear`.
Verificare che `/login` abbia `lang="it"` e che una richiesta di accesso non valida
mostri un errore italiano; il solo aggiornamento degli esempi `.env` non modifica
un overlay già esistente.

I cataloghi nativi in `lang/it` e `lang/it.json` coprono validazione, accesso,
password, notifiche standard e pagine di errore. Il calendario usa la locale
italiana già inclusa in DayPicker, comprese le etichette accessibili. La terminologia
visibile resta **Azienda** e **Amministrazione**; nomi tecnici, route e dati salvati
mantengono gli identificatori esistenti.

Restano intenzionalmente nella lingua originale:

- testi inseriti dagli utenti, nomi dei dispositivi, marchi e identificatori tecnici;
- finestre native WebAuthn/browser, controllate dal dispositivo e dalla sua lingua;
- diagnostica sconosciuta restituita dal browser/dispositivo per le passkey:
  `resources/js/lib/passkey-error.ts` traduce i messaggi riconoscibili delle librerie
  installate e conserva gli altri per non perdere informazioni utili;
- log, messaggi della console sviluppatore ed eccezioni tecniche non esposte dalla UI
  (per esempio `Search failed`, `Copy failed` e gli errori interni degli allegati);
- output dei comandi di manutenzione di Laravel e delle dipendenze, non dei comandi
  applicativi. Gli errori dei servizi esterni già intercettati mantengono il
  messaggio italiano dell'applicazione; i dettagli originali rimangono nei log.

Prima del merge, verificare manualmente in Docker accesso/reset password,
profilo/sicurezza, passkey e 2FA, menu mobile e calendario. Per ripetere i test
localizzati: `php artisan test --stop-on-failure --filter=LocalizationTest` e
`npx vp test --run tests/frontend/localization.test.tsx`.
