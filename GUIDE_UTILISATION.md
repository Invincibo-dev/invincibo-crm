# Guide d'utilisation du CRM CV-PAM

Ce guide explique comment utiliser le CRM au quotidien, module par module, avec la logique métier derrière chaque option.

## 1. Vue d'ensemble

Le CRM sert à suivre trois grands flux:

- Prospects et clients: contacts, leads, statuts, tags, relances.
- Activation: élèves/clients déjà payés, onboarding, progression, risques d'abandon.
- Support: tâches internes à traiter pour débloquer les élèves ou clients.

Les deux espaces en ligne sont:

- Frontend: `https://cv-pam.com`
- API backend: `https://api.cv-pam.com`

L'utilisateur doit se connecter avec un compte CRM. Le premier compte créé est l'admin principal.

## 2. Connexion

Page:

```text
https://cv-pam.com/login
```

Saisir:

- Email
- Mot de passe

Après connexion, l'utilisateur arrive sur le Dashboard.

Roles:

- `admin`: peut créer utilisateurs, supprimer des contacts, lancer certaines actions sensibles.
- `agent`: peut gérer les contacts, relances, groupes, activation et support selon les droits prévus.

## 3. Dashboard

Objectif: donner une vue rapide de la performance commerciale.

Indicateurs principaux:

- Total Leads: nombre total de contacts/leads.
- Clients: nombre de leads passés au statut client.
- Conversion %: clients divisé par total leads.
- Leads Chauds: leads avec score élevé.
- Messages Envoyés: messages enregistrés comme envoyés.
- Relances en attente: follow-ups encore pending.

Filtre par tag:

- Permet de filtrer certaines statistiques selon un tag.
- Exemple: voir uniquement les contacts liés à une offre ou campagne.

Boutons de navigation:

- Contacts
- Relances
- Activation
- Groupes
- Support
- Déconnexion
- Gérer utilisateurs, visible pour admin.

Logique métier:

Le Dashboard est un poste de pilotage. Il ne sert pas à saisir beaucoup de données, mais à voir où agir: relancer, qualifier, traiter les problèmes ou suivre l'activation.

## 4. Contacts

Objectif: gérer les prospects/leads commerciaux.

Actions disponibles:

### Ajouter un contact

Champs:

- Nom complet
- Téléphone
- Email
- Source
- Genre

Quand un contact est créé:

- Le lead est enregistré.
- Une séquence de relance est préparée automatiquement.
- Le score du lead est calculé.
- Si WhatsApp est configuré, un message initial peut être tenté.

Important:

Pour l'instant, si WhatsApp n'est pas configuré, la création du contact peut enregistrer un échec d'envoi WhatsApp. Ce n'est pas forcément grave pour tester le CRM, mais il faut configurer WhatsApp avant usage réel massif.

### Importer des contacts

Formats acceptés:

- CSV
- TSV
- TXT
- JSON

Colonnes reconnues:

- `name`, `nom`, `full_name`
- `phone`, `telephone`, `mobile`, `whatsapp`
- `email`

Exemple CSV:

```csv
nom,telephone,email
Marie Noel,+50912345678,marie@email.com
Jean Pierre,+50987654321,jean@email.com
```

### Tags

Les tags servent à segmenter les leads.

Exemples:

- Formation
- Prospect chaud
- Paiement en attente
- Client VIP
- Campagne Facebook

Actions:

- Créer un tag.
- Ajouter un tag à un contact.
- Retirer un tag d'un contact.

### Statut du lead

Statuts:

- Nouveau
- Contacté
- Client
- Sans réponse

Logique métier:

Le statut indique le niveau d'avancement commercial. Quand un lead devient client, ses relances commerciales peuvent être arrêtées.

### Stop sequence

Annule les relances automatiques pending d'un contact.

Utiliser quand:

- Le lead est déjà client.
- Le prospect demande à ne plus être contacté.
- Le contact est invalide.

## 5. Relances

Objectif: planifier et traiter les follow-ups des contacts.

### Planifier une relance

Champs:

- Contact
- Date/heure
- Message
- Étape de séquence

La relance reste en attente jusqu'à sa date.

### Relances dues

Une relance est due quand:

```text
scheduled_date <= maintenant
```

### Envoyer les relances dues

Bouton:

```text
Envoyer les relances dues
```

Cette action appelle le processeur backend:

```text
POST /api/followups/process
```

Important:

- Cette action est réservée aux admins.
- Elle nécessite WhatsApp configuré pour envoyer réellement.
- Tant que WhatsApp n'est pas configuré, cette action peut échouer.

### Cron automatique

Variable backend:

```text
FOLLOWUP_CRON_ENABLED=false
```

À garder sur `false` tant que WhatsApp n'est pas prêt.

Quand WhatsApp sera configuré:

1. Tester manuellement `Envoyer les relances dues`.
2. Vérifier les logs.
3. Mettre `FOLLOWUP_CRON_ENABLED=true`.
4. Redémarrer le backend.

Logique métier:

Les relances évitent d'oublier les prospects. Le cron ne doit être activé que quand les messages sont prêts et validés.

## 6. Activation

Objectif: suivre les élèves/clients après paiement jusqu'à activation complète.

Statuts:

- Formation payée
- Onboarding
- Étape 1
- Actif
- Inactif
- Bloqué
- À risque

### Ajouter élève

Champs:

- Nom
- Téléphone
- Statut initial

Utiliser quand un client a payé ou entre dans le processus d'activation.

### Progression

Actions rapides:

- Démarrer onboarding
- Étape 1 complétée
- Serveur activé

Chaque action met à jour le statut et peut créer un historique.

### Vérifier à risque

Bouton:

```text
Vérifier à risque
```

Le système cherche les élèves sans action récente.

Logique:

Un élève devient à risque s'il reste trop longtemps sans progression ou sans interaction.

### Recovery at-risk

Bouton:

```text
Recovery at-risk
```

Objectif:

- Déclencher une récupération des élèves à risque.
- Créer ou envoyer des actions selon la configuration.

Attention:

Les actions qui envoient WhatsApp demandent une configuration WhatsApp valide.

### Historique

Permet de voir les actions liées à un élève:

- Support
- Progression
- Messages
- Recovery

## 7. Groupes

Objectif: créer des segments de contacts pour actions ciblées.

Exemples de groupes:

- Clients non payés
- Élèves bloqués
- Prospects intéressés
- Relance paiement
- Support technique

### Créer groupe

Champs:

- Nom
- Catégorie
- Description

### Ajouter contact existant

Types de membres:

- Lead
- Élève

Champs complémentaires:

- Problème / raison
- Notes

Exemple:

```text
Problème: paiement en attente
Notes: relancer vendredi matin
```

### Import CSV dans un groupe

Permet d'ajouter plusieurs contacts à un groupe.

Exemple:

```csv
name,phone,email,problem_reason,notes
Marie Noel,+50912345678,marie@email.com,non paye,a rappeler
```

Le système peut:

- Créer de nouveaux leads.
- Réutiliser des leads existants.
- Ajouter les contacts valides au groupe.
- Ignorer les doublons.
- Signaler les lignes invalides.

### Modifier membre

Permet de mettre à jour:

- Problème
- Notes

### Relance groupe

Le groupe peut générer un aperçu de message.

Variables disponibles:

```text
{{name}}
{{phone}}
{{groupName}}
```

Exemple:

```text
Bonjou {{name}}, nap kontakte w pou dosye {{groupName}}.
```

Règle importante:

L'aperçu est obligatoire avant l'envoi réel.

Tant que WhatsApp n'est pas configuré, ne pas utiliser l'envoi réel.

## 8. Support

Objectif: suivre les tâches internes nécessaires pour débloquer les élèves.

Types de tâches:

- Onboarding
- Paiement
- Activation serveur
- Motivation
- Technique

Priorités:

- Urgent
- Normal
- Faible

Statuts:

- En attente
- En cours
- Résolue

### Filtres

On peut filtrer par:

- Priorité
- Statut
- Type

### Assigner à moi

Assigne la tâche à l'utilisateur connecté.

Utiliser quand un agent prend la responsabilité du problème.

### Résoudre

Marque la tâche comme résolue.

Le système garde une trace de l'action.

Logique métier:

Le Support sert à transformer les problèmes dispersés en tâches visibles. Il évite que les élèves bloqués restent invisibles.

## 9. Utilisateurs

Visible pour admin.

Objectif:

- Voir les utilisateurs CRM.
- Préparer la gestion des agents.

Règle actuelle:

- Le premier utilisateur peut être créé sans admin existant.
- Ensuite, seuls les admins peuvent créer/lister les utilisateurs selon les routes prévues.

## 10. WhatsApp

Variables nécessaires:

```text
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
```

Pour l'instant, elles peuvent rester vides si:

```text
FOLLOWUP_CRON_ENABLED=false
```

Mais avant usage réel de WhatsApp:

1. Récupérer `WHATSAPP_PHONE_NUMBER_ID` dans Meta Developers.
2. Créer un token permanent ou long terme via Meta Business.
3. Mettre les valeurs dans Hostinger.
4. Tester une relance manuelle.
5. Activer le cron seulement après validation.

## 11. Ordre recommandé d'utilisation quotidienne

1. Ouvrir Dashboard.
2. Vérifier les leads, clients, relances pending.
3. Aller dans Contacts pour ajouter/importer les prospects.
4. Taguer et qualifier les contacts.
5. Planifier ou vérifier les Relances.
6. Ajouter les clients payés dans Activation.
7. Vérifier les élèves à risque.
8. Utiliser Support pour traiter les blocages.
9. Utiliser Groupes pour segmenter les contacts problématiques ou importants.

## 12. Actions à éviter pour l'instant

Tant que WhatsApp n'est pas configuré:

- Ne pas activer `FOLLOWUP_CRON_ENABLED=true`.
- Ne pas lancer d'envoi groupe réel.
- Ne pas utiliser les recoveries WhatsApp sur de vrais clients sans test.

Actions sûres:

- Connexion
- Dashboard
- Création contact
- Import contacts
- Tags
- Groupes sans envoi réel
- Activation sans recovery WhatsApp réel
- Support

## 13. Tests rapides après chaque mise à jour

Backend:

```powershell
Invoke-RestMethod -Uri "https://api.cv-pam.com/health"
```

Login:

```powershell
Invoke-RestMethod `
  -Uri "https://api.cv-pam.com/api/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"admin@cv-pam.com","password":"VOTRE_MOT_DE_PASSE"}'
```

Frontend:

- Ouvrir `https://cv-pam.com`
- Se connecter
- Tester Dashboard
- Tester Contacts
- Tester Relances
- Tester Activation
- Tester Groupes
- Tester Support

## 14. Notes pratiques

- Si une page devient blanche, ouvrir DevTools > Console.
- Si l'API répond 401, se reconnecter.
- Si l'API répond 500, regarder les runtime logs Hostinger.
- Si WhatsApp échoue, vérifier token, phone number ID et permissions Meta.
- Si une route frontend donne 404 au refresh, vérifier `.htaccess` dans `public_html`.
