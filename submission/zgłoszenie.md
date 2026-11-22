# Druga Strona Oceny

Prototyp cyfrowego asystenta ocen okresowych w służbie cywilnej.

## Problem

Przełożony zbiera obserwacje, pilnuje procedury i przygotowuje ocenę. Pracownik potrzebuje konkretnej informacji zwrotnej i możliwości uzupełnienia kontekstu. Kadry potrzebują kompletnego arkusza i kontroli terminów. Nawet gdy w rozmowie wychodzi na jaw przeszkoda organizacyjna, jej rozwiązanie może stracić właściciela po zakończeniu oceny.

## Rozwiązanie

Aplikacja prowadzi przez dobór arkusza A, B lub C, wybór kryteriów, rozmowę początkową, obserwacje, rozmowę oceniającą, zatwierdzenie i eksport. Przełożony ustala oceny. Wirtualny partner HR wiąże sugestie z obserwacjami, wskazuje luki w uzasadnieniu i proponuje pytania do rozmowy. Pracownik może dopisać kontekst do udostępnionych informacji.

Po rozmowie przełożony i pracownik mogą rozpocząć **30-dniową próbę zmiany**. Przełożony wybiera propozycję lub opisuje własne działanie, wskazuje właściciela i ustala miernik oraz termin przeglądu. Widok porównania pokazuje liczbę zdarzeń i wielkość badanej grupy. W fikcyjnym przykładzie liczba spraw przesuniętych bez uzgodnienia spada z 8 do 4, a odsetek rośnie z 40% (8/20) do 50% (4/8), czyli o 10 punktów procentowych. Przy tak małej liczbie obserwacji przełożony może zdecydować o powtórzeniu próby z tym samym wskaźnikiem i zachowaniem poprzednich wyników. Formalny przebieg oceny oraz ustalenia dotyczące organizacji pracy mają własne statusy.

## Demonstracja

Uruchom `npm run demo:ai` albo `npm start` z ustawieniami konkursowymi z README. Kliknij **Zobacz rozmowę Anny**. Cały pokaz korzysta z tej samej fikcyjnej sprawy.

1. **0:00–0:35** · W Partnerze HR pokaż trzy listopadowe opóźnienia i wrześniowy wpis o 12 sprawach oddanych w terminie. Wybierz **Otwórz wpis** albo zadaj pytanie lokalnemu asystentowi na wspólnym ekranie i wybierz **Pokaż na osi**.
2. **0:35–1:05** · Przeczytaj komentarz Anny o przejęciu pilnej kolejki. Zapytaj, kto i kiedy ustalał, które sprawy można przesunąć. Przełożony proponuje wspólne uzgadnianie priorytetów.
3. **1:05–1:35** · Rozpocznij fikcyjną próbę i wybierz **Przejdź o 30 dni do wyniku**. Pokaż 8/20 → 4/8 oraz 40% → 50%. Użyj **Zmień działanie i zaplanuj kolejną próbę**. Wynik pierwszej próby pozostaje widoczny.
4. **1:35–2:00** · Otwórz **Dokumenty i historia** w tej samej sprawie. Pokaż rozróżnienie wersji części I, aktualnego terminu i obiegu podpisanego dokumentu. Przy starszych danych widoczny jest brak historycznej wersji.

W widoku kadr każda grupa obejmuje jedną przeszkodę oraz zgodne definicje zdarzenia, mianownika i źródła. Statystyka wymaga pięciu różnych osób i wykorzystuje ich ostatnie porównywalne wyniki.

## Kryteria konkursu

| Kryterium | Co można ocenić w demonstracji |
| --- | --- |
| Związek z wyzwaniem (30%) | Przebieg oceny, warianty A/B/C, maksymalnie trzy dodatkowe kryteria, role i sposób wyznaczania terminu. |
| Oryginalność (20%) | Wybór lub opis własnej próby, porównanie wyniku z pełnym mianownikiem i świadoma decyzja o powtórzeniu. |
| Kompletność (20%) | Jedna sprawa od rozmowy początkowej do dokumentu i przeglądu działania rozwojowego. |
| Potencjał wdrożeniowy (30%) | Uruchomienie w środowisku urzędu, oddzielenie reguł od treści oceny i możliwość pracy bez obowiązkowej płatnej usługi. |

## Zakres prototypu i pilotażu

Dane sprawy i wyniki 30-dniowej próby są fikcyjne. Przed pilotażem urząd weryfikuje wzory i reguły, dobiera sposób podpisywania dokumentów oraz uzgadnia integrację z obiegiem akt.
## Porównanie pracy w pilotażu

Przygotuj dwie fikcyjne sprawy o podobnej złożoności. Każda zawiera ten sam typ arkusza, zmianę terminu, odpowiedź pracownika oraz obserwacje z okresu i spoza okresu. Każdy uczestnik opracuje jedną sprawę dotychczasowym sposobem i drugą w aplikacji. Zamień kolejność metod u co drugiego uczestnika. Użyj tej samej instrukcji i listy odbioru arkusza.

| Pomiar | Jak zapisać |
| --- | --- |
| Czas | Minuty od otrzymania sprawy do oddania pierwszego arkusza do weryfikacji |
| Poprawki | Liczba odrębnych braków lub błędów wskazanych przez weryfikatora przed akceptacją arkusza |
| Powiązanie wniosków | Liczba wniosków z odnośnikiem do właściwej obserwacji z okresu podzielona przez liczbę wszystkich wniosków |

Zapisz anonimowy identyfikator uczestnika, metodę, zestaw sprawy, kolejność i trzy wyniki. Po sesjach podaj liczebność, medianę różnic w parach i odnotowane trudności. Status pomiaru · zaplanowany.

[Oficjalny opis i regulamin zadania](https://hacknation.pl/zadania)
