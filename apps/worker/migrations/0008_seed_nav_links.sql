-- Seed homepage navigation links (configurable via admin settings)
INSERT INTO settings (key, value, type)
VALUES (
  'general.navigation.header_links',
  '[{"label":"同济网论坛","url":"/"},{"label":"就业实习","url":"/forums/2"},{"label":"导读","url":"/digest"},{"label":"考研","url":"/forums/3"},{"label":"嘉定新风","url":"/forums/4"},{"label":"同济闲话","url":"/forums/5"},{"label":"情感空间","url":"/forums/6"},{"label":"鹊桥","url":"/forums/7"},{"label":"竞猜","url":"/forums/8"},{"label":"签到","url":"/forums/9"},{"label":"道具","url":"/forums/10"}]',
  'json'
)
ON CONFLICT (key) DO NOTHING;
