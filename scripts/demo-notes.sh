#!/bin/sh
# Writes a set of English example notes into a folder, for the screenshots in the README: notes of your own and
# notes AI apps saved, to-dos with reminders due today, tomorrow and later (their times counted from now, so the to-do
# view groups them), a locked note, code, quotes and links. Point Jot at the folder (Settings → General → Notes
# Folder) and take the screenshots there; your own notes are not touched.
#
# Usage: scripts/demo-notes.sh [folder]   (default: ~/Documents/Jot Demo)
#
# Running it again rewrites these notes (and their times); anything else in the folder stays as it is.
set -eu

dir=${1:-"$HOME/Documents/Jot Demo"}
mkdir -p "$dir"

# Dates and times counted from now (BSD date, as on macOS).
day() { date -v"$1"d +%Y-%m-%d; }
d_m1=$(day -1)
d_0=$(day +0)
d_p1=$(day +1)
d_p2=$(day +2)
d_p5=$(day +5)
d_fri=$(date -v+fri +%Y-%m-%d)
pretty_today=$(date +"%b %-d")

# note <title> <minutes ago>: the note's text from stdin, with {{…}} filled in; its modified time set to that many
# minutes ago, so the list shows the notes in this order.
note() {
  path="$dir/$1.md"
  [ -e "$path" ] && chflags nouchg "$path"
  sed -e "s/{{D-1}}/$d_m1/g" -e "s/{{D0}}/$d_0/g" -e "s/{{D+1}}/$d_p1/g" -e "s/{{D+2}}/$d_p2/g" \
    -e "s/{{D+5}}/$d_p5/g" -e "s/{{FRI}}/$d_fri/g" -e "s/{{TODAY}}/$pretty_today/g" >"$path"
  touch -t "$(date -v-"$2"M +%Y%m%d%H%M)" "$path"
}

note "This week" 2 <<'EOF'
Three things that matter, everything else can wait.

## Focus

- [ ] Ship the **onboarding** redesign ⏰ {{D0}} 17:00
- [ ] Send the weekly report to the team ⏰ {{FRI}} 16:00
- [ ] Review Maya's pull request ⏰ {{D+1}} 10:30

## Errands

- [ ] Renew the passport ⏰ {{D-1}} 09:00
- [ ] Call the landlord about the heating ⏰ {{D0}} 18:30
- [ ] Pick up the dry cleaning
- [x] Book the dentist ✅ {{D-1}}
- [x] Pay rent ✅ {{D-1}}
EOF

note "Design review · $pretty_today" 25 <<'EOF'
---
source: claude
---
Summary of today's review of the new onboarding flow.

## Decisions

- Keep the welcome screen to **one sentence** and one button.
- Move the permission prompt to the moment it is needed, not the first launch.
- Dark mode ships in the same release.

## Open questions

> Should the sample notes be removable in one step, or stay until the user deletes them?

## Follow-ups

- [ ] Alex: new empty-state illustrations ⏰ {{D+2}} 12:00
- [ ] Sam: copy for the permission prompt ⏰ {{D+1}} 15:00
- [ ] Share the recording with the wider team
EOF

note "Homelab" 70 <<'EOF'
## Ubuntu box

- Host: `nas.local` (192.168.1.20)
- User: `admin`, key in 1Password under **Homelab SSH**
- Disks: 2 × 8 TB, ZFS mirror `tank`

```sh
ssh admin@nas.local
zpool status tank
```

## Raspberry Pi

- Runs Pi-hole and Home Assistant
- Dashboard: [http://pi.local:8123](http://pi.local:8123)

## To do

- [ ] Replace the UPS battery ⏰ {{D+5}} 10:00
- [ ] Set up off-site backups
EOF

note "Deploy with Docker Compose" 140 <<'EOF'
---
source: claude-code
---
The steps we used to deploy the API to the staging server.

```sh
git pull origin main
docker compose build api
docker compose up -d api
docker compose logs -f api --tail 50
```

## Rolling back

Tag the image before each deploy, then:

```sh
docker compose down api
IMAGE_TAG=previous docker compose up -d api
```

*Remember:* run the migrations with `docker compose run --rm api migrate` **before** starting the new version.
EOF

note "Trip to Kyoto" 300 <<'EOF'
Dec 12 – Dec 18, five nights in Higashiyama.

## Plan

- **Day 1**: Fushimi Inari early, before the crowds
- **Day 2**: Arashiyama bamboo grove, then the monkey park
- **Day 3**: Nishiki Market, tea ceremony in the afternoon
- **Day 4**: day trip to Nara

## Before we go

- [ ] Book the ryokan ⏰ {{D0}} 21:00
- [ ] Get a Suica card on the phone
- [x] Flights booked ✅ {{D-1}}

[Kyoto city bus map](https://www.city.kyoto.lg.jp)
EOF

note "Git snippets" 1500 <<'EOF'
---
source: cursor
---
Undo the last commit, keep the changes:

```sh
git reset --soft HEAD~1
```

Find which commit broke the tests:

```sh
git bisect start
git bisect bad
git bisect good v1.4.0
```

Clean up merged branches:

```sh
git branch --merged main | grep -v main | xargs git branch -d
```
EOF

note "Ideas" 2900 <<'EOF'
- A **weekly digest** of the notes I wrote, every Sunday evening
- Keyboard-only mode for the whole app
- ~~Sync built into the app~~ iCloud Drive already does this
- Templates for meeting notes
- A *reading list* that pulls titles from links

> The best ideas come from writing things down before they are good.
EOF

note "Weeknight ramen" 5800 <<'EOF'
Twenty minutes, serves two.

## Ingredients

- 2 portions of fresh noodles
- 1 l chicken stock
- 2 tbsp white miso, 1 tbsp soy sauce
- 2 soft-boiled eggs, scallions, nori

## Steps

1. Warm the stock; whisk in the miso and soy sauce off the heat.
2. Cook the noodles for 2 minutes, drain.
3. Pour the broth over the noodles, top with the eggs, scallions and nori.

*Tip:* a spoon of chili oil at the end.
EOF

note "Apartment lease" 11000 <<'EOF'
---
locked: true
---
- Signed: March 1, 2026, for 24 months
- Rent: $1,850, due on the 1st of each month
- Deposit: $3,700, returned within 30 days of moving out
- Notice to leave: **60 days**, in writing

Landlord: Greenway Property Management, (555) 014-2290
EOF
chflags uchg "$dir/Apartment lease.md"

echo "Wrote the example notes to $dir"
