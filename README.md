cd ~/sanat-tam 2>/dev/null || cd /workspaces/$(ls /workspaces | head -1)
git remote -v
git log --oneline | head -3# Suomen-Kieli