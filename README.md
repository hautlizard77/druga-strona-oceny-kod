# Druga Strona Oceny

Cyfrowy asystent ocen okresowych służby cywilnej. Pracownik może dopisać kontekst do udostępnionej obserwacji. Przełożony sprawdza podstawę uzasadnienia, wybiera oceny cząstkowe i ustala jedno działanie organizacyjne z miernikiem i terminem sprawdzenia. Kadry koordynują sprawy i przejęcie oceny przez nowego oceniającego. Dyrekcja widzi statystyki zbiorcze.

## Uruchomienie demonstracji

Potrzebny jest Node.js 22 lub nowszy. Aplikacja nie wymaga instalacji paczek ani klucza do zewnętrznej usługi.

```sh
npm start
```

Otwórz [http://127.0.0.1:4173/](http://127.0.0.1:4173/) i wybierz rolę na ekranie logowania. Jeśli port jest zajęty, ustaw `DSO_PORT` przed uruchomieniem. `npm test` uruchamia testy reguł, zapisu i zakresów dostępu.

Fikcyjny urząd ma 13 spraw w dwóch wydziałach, na sześciu etapach oceny. **Więcej kont demonstracyjnych** umożliwia wejście m.in. na konto Aleksandry Rybak z Wydziału Kontroli i Organizacji oraz Jakuba Pawlaka, który ma ocenę do potwierdzenia. W widoku **Kadry → Statystyki** pięć zakończonych prób tworzy porównywalną grupę. Jedna próba z inną definicją pozostaje poniżej progu publikacji. Daty dodatkowych spraw są ustawiane względem dnia pierwszego wczytania zestawu. Zestaw dołącza się jednorazowo do bazy demonstracyjnej i zachowuje dotychczasowe sprawy.

### Pokaz konkursowy na jednej sprawie

Włącz `DSO_JURY_DEMO=1` i przy pierwszym uruchomieniu wskaż nowy `DSO_DATA_FILE`. Polecenie `npm run demo:ai` włącza tryb konkursowy. Do powtórzenia pokazu od początku użyj kolejnego pliku demonstracyjnego.

1. Kliknij **Zobacz rozmowę Anny**. W **Partnerze HR** wybierz kryterium organizacji pracy. Pokaż trzy listopadowe opóźnienia, pozytywny wrześniowy wpis i fikcyjny komentarz Anny. Kliknij **Otwórz wpis**, aby sprawdzić datę i źródło.
2. Na tej samej sprawie wybierz **Rozpocznij fikcyjną próbę**, a potem **Przejdź o 30 dni do wyniku**. Liczba przesunięć spada z 8 do 4, a odsetek rośnie z 40% do 50%. Kliknij **Zmień działanie i zaplanuj kolejną próbę**. Kolejny pomiar używa tej samej definicji.
3. W zwykłym obiegu przełożony zapisuje własną próbę z definicją zdarzenia, zakresem spraw w mianowniku i źródłem danych. **Statystyki** stosują próg pięciu osób dla tej samej przeszkody i pełnej definicji. Pomiary bez kompletnej definicji są dostępne w historii sprawy.

## Wspólny ekran rozmowy

### Pokaz z lokalnym agentem AI

Na Windows x64 uruchom `npm run demo:ai`. Pierwsze uruchomienie pobiera model Qwen3-1.7B Q4_K_M i silnik llama.cpp (łącznie ok. 1,3 GB), sprawdza sumy SHA-256 i zapisuje pliki w `%LOCALAPPDATA%\DrugaStronaOceny\ai`. Kolejne uruchomienia korzystają z kopii lokalnej. Aplikacja otwiera port 4177, model nasłuchuje na adresie pętli zwrotnej. Zwykłe `npm start` uruchamia aplikację z gotowymi poleceniami. Już działający lokalny serwer llama.cpp można podłączyć przez `DSO_AI_URL` (pełny adres trasy `/v1/chat/completions`) i opcjonalnie `DSO_AI_MODEL` (domyślnie alias `local`).

Wybierz **Zobacz rozmowę Anny → Wspólny ekran rozmowy → Zapytaj asystenta**. Wpisz „Co wiemy z wcześniejszej części okresu?”. Model dostaje tekst pytania i wybiera narzędzie. Aplikacja wykonuje je na udostępnionych wpisach dla wybranego kryterium. Przy odpowiedzi wybierz **Pokaż na osi**, aby przejść do konkretnej obserwacji. Możesz też odszukać komentarze pracownika lub przygotować pytania do spotkania. W odpowiedzi widać wybrane narzędzie, co ułatwia wychwycenie pomyłki modelu. Automatyczne polecenia mają dostęp wyłącznie do odczytu. [Model GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF) · [Wydanie llama.cpp](https://github.com/ggml-org/llama.cpp/releases/tag/b8180)

### Rozmowa na dwóch ekranach

Na ekranie logowania wybierz **Zobacz rozmowę Anny**, potem **Wspólny ekran rozmowy**. W demonstracji trzy wpisy z ostatnich 30 dni dotyczą opóźnień. Wybierz **Pokaż cały okres**, aby zobaczyć również wrześniowy wpis o 12 sprawach przekazanych w terminie. W zwykłej sprawie przełożony lub pracownik otwiera **Wspólny ekran rozmowy** z nagłówka sprawy. Przełącznik i filtr kryterium działają na udostępnionych obserwacjach tej sprawy.

Do prezentacji na dwóch ekranach otwórz konto pracownika w osobnym profilu przeglądarki albo oknie prywatnym. W sprawie Anny wybierz **Obserwacje → Dodaj kontekst** przy listopadowym wpisie. Na widocznym wspólnym ekranie odpowiedź pojawi się przy tym wpisie po następnym odświeżeniu (co cztery sekundy). Do ekranu mają dostęp obie strony po zalogowaniu. Serwer przesyła osobny zestaw danych z udostępnionymi wpisami i odpowiedziami.

## Przekazanie dokumentu do akt

1. W sprawie otwórz **Dokumenty i historia** i pobierz urzędowy arkusz DOCX A, B lub C. Sprawdź treść i skieruj dokument do podpisania w obiegu urzędu.
2. Po obu potwierdzeniach przełożony lub kadry dołączają podpisany PDF. Aplikacja zachowuje oryginalne bajty, SHA‑256 i historię dołączenia.
3. Pobierz **Paczkę do akt ZIP** z PDF i manifestem albo **Szkic wiadomości EML** z załącznikiem. Paczkę przekaż w obiegu urzędu. Szkic otwórz w kliencie poczty, sprawdź adresata i treść przed wysłaniem.
4. Po przekazaniu wybierz **Zapisz przekazanie** i podaj sygnaturę EZD albo identyfikator potwierdzenia z poczty. Zapis trafia do historii sprawy.

Potwierdzenie pracownika zapisuje część I wraz z widocznym wtedy terminem. Zmiana terminu uaktualnia kolejkę i przypomnienia oraz zapisuje obie daty w historii. Sygnaturę i datę pisemnego zawiadomienia wpisz przy zdarzeniu kadrowym. Manifest ZIP przenosi referencję do kopii pozostającej w obiegu urzędu. W przypadku starszego potwierdzenia bez zachowanego zapisu historia pokazuje brak, a DOCX pozostawia część I do uzupełnienia z dokumentacji.

W **Dokumentach i historii** zapisz daty doręczenia kopii i zapoznania się z oceną. Obie daty muszą przypadać w dniu sporządzenia oceny lub później. Korekta wymaga powodu i zachowuje daty przed i po zmianie wraz z autorem. Pracownik widzi przeliczony termin sprzeciwu.

ZIP i EML są plikami do ręcznego przekazania. Automatyczne przekazywanie wymaga podłączenia uwierzytelnionego API konkretnego systemu. [Dokumentacja piaskownicy EZD RP](https://www.gov.pl/web/ezd-rp/piaskownica-api)

Sprawa pokazowa zaczyna się w trakcie okresu, z zapisanym otwarciem. **Nowa ocena** pozwala przejść od arkusza i obustronnego potwierdzenia rozmowy początkowej. W trybie demonstracyjnym dane i konta są fikcyjne. Domyślnie zapis trafia do `data/demo.json`. Oddzielną demonstrację można rozpocząć przez podanie nowej ścieżki `DSO_DATA_FILE`, bez usuwania poprzednich danych.

Przykład uruchomienia odrębnej bazy konkursowej.

```powershell
$env:DSO_JURY_DEMO = '1'
$env:DSO_DATA_FILE = Join-Path $env:TEMP "oceny-final-$([guid]::NewGuid()).json"
npm start
```

## Uruchomienie w zamkniętym środowisku urzędu

Skonfiguruj własne konta w pliku JSON poza repozytorium i ustaw `DSO_ACCOUNTS_FILE` na bezwzględną ścieżkę. Każdy wpis zawiera `id`, `username`, `name`, `role`, `officeId`, `officeName` oraz `passwordHash` w formacie `16-bajtowa-sól-hex:64-bajtowy-scrypt-hex`. Dostępne role to `manager`, `employee`, `hr` i `director`. Lokalnie do prób można użyć pola `password` z hasłem dłuższym niż 11 znaków, ale do pliku utrzymywanego w urzędzie wpisuj skróty. Przykładowy [generator skrótu](https://nodejs.org/api/crypto.html#cryptoscryptsyncpassword-salt-keylen-options) wykorzystuje `randomBytes(16)` i `scryptSync(password, salt, 64)`.

- `DSO_DATA_FILE` wskazuje plik danych, dla którego uruchamiana jest jedna instancja serwera. Przechowuj go w katalogu dostępnym dla procesu. Twórz spójne kopie pliku danych i sąsiedniego katalogu `<nazwa pliku danych>.signed-files`, jeżeli dołączono dokumenty.
- Wpis pracownika może zawierać `directManagerId` z listy zatwierdzonej w urzędzie. Kadry zmieniają powiązanie w zakładce **Podległość**. Jeżeli trwa ocena, po zatwierdzeniu relacji trzeba osobno przekazać sprawę nowemu przełożonemu.
- Przed potwierdzeniem oceny przełożony uzupełnia dane właściwego arkusza. Pole **Data sporządzenia oceny** służy do wpisania rzeczywistej daty. Jeżeli pozostanie puste, aplikacja zapisze datę potwierdzenia przełożonego. W zakładce **Dokumenty i historia** kadry lub przełożony zapisują faktyczne doręczenie kopii i datę zapoznania się z oceną. Od tej drugiej daty pracownik widzi termin sprzeciwu. [Art. 83 ustawy o służbie cywilnej](https://eli.gov.pl/eli/DU/2026/590/ogl)
- `DSO_HOST` i `DSO_PORT` określają adres i port nasłuchu. Domyślnie serwer słucha tylko na komputerze lokalnym. Przy dostępie z sieci urzędu użyj odwrotnego proxy z TLS i ustaw `DSO_ORIGIN` na pełny adres HTTPS aplikacji.
- Po podaniu pliku kont demonstracyjne logowanie jest wyłączone. Widok kadr pozwala symulować zmianę cyklu i limitów w trybie demonstracyjnym. Sprawy zachowują wersję swoich reguł. Zmianę prawną w normalnym trybie wprowadza się w `public/domain.mjs` po uwzględnieniu przepisów przejściowych.

### Aktualizacja i próba odtworzenia

Każda nowa sprawa zapisuje parametry reguł i identyfikator pakietu wzorów. Starsze sprawy bez tego identyfikatora używają wzorów 2016.470. Eksport sprawdza sumę SHA-256 wzoru. Przy zmianie wzorów dodaj nową pozycję w rejestrze pakietów i zachowaj dotychczasowe pliki. Wydanie reguł ustaw jako domyślne dla nowych spraw. Ewentualne przejście rozpoczętych spraw na nowe przepisy wykonaj po ustaleniu, które sprawy obejmuje przepis przejściowy.

Uruchom `node scripts/pilot-check.mjs`, aby odtworzyć próbę z sześcioma fikcyjnymi zespołami. Skrypt mierzy zapisy, sprawdza odrzucenie zapisu na nieaktualnej wersji, odtwarza zamkniętą sprawę z PDF i porównuje sumę załącznika. Kopiuje bazę i katalog załączników po zatrzymaniu tej instancji. Wygasza wyłącznie fikcyjną parę plików kopii i sprawdza, czy odtworzona instancja ją przeżyła.

W wykonanej próbie 120 zapisów przy 180 sprawach trwało około 1,0 s, a p95 wyniosło 56 ms. Baza miała 723 kB. Wynik dotyczy jednej lokalnej instancji i wskazanego obciążenia. Przed pilotażem użyj ustalonego z urzędem wolumenu i harmonogramu retencji. Serwer nie usuwa sam spraw ani dokumentów.

## Pomiar z użytkownikami

[Scenariusz porównania pracy w pilotażu](submission/zgłoszenie.md#porównanie-pracy-w-pilotażu) opisuje zadania, metryki i arkusz pomiaru. Wyniki będą dostępne po sesjach z użytkownikami.

## Zakres prototypu konkursowego

- Formularze A/B/C można wydrukować z aplikacji albo pobrać jako edytowalny DOCX oparty na urzędowym wzorze. Źródła są w [wykazie wzorów](assets/formularze/README.md).
- Potwierdzenia w aplikacji zapisują osobę, moment i etap obiegu. Po zakończeniu sprawy przełożony lub kadry mogą dołączyć PDF podpisany w obiegu urzędu. Aplikacja zachowuje plik i jego sumę SHA‑256. Weryfikację podpisu i włączenie do akt przeprowadza urząd w swoim obiegu.
- Eksport obejmuje też dane arkusza JSON i przypomnienie `.ics` do kalendarza. Tytuły przypomnień nie zawierają danych pracownika.
- Partner HR korzysta z reguł i zapisanych obserwacji. Zmiany organizacyjne można wybrać spośród propozycji lub opisać samodzielnie. Stopnie cząstkowe wprowadza człowiek. Próby i ich wyniki nie ingerują w zatwierdzoną ocenę.
- Przed pracą z rzeczywistą dokumentacją urząd weryfikuje reguły, wzory, retencję, podpisy i docelową infrastrukturę.

[Opis zgłoszenia](submission/zgłoszenie.md)
