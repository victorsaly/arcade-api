-- Sign in with Apple, and the one token it makes us keep.
--
-- Apple requires that deleting an account also revokes the app's access to
-- that Apple Account, and revoking needs a token Apple issued at sign-in. So
-- for players who signed in with Apple, and only for them, that refresh token
-- is kept here. It is used exactly once, when they delete their account, and
-- it goes with the row. Google players have none: nothing of Google's is kept.
ALTER TABLE players ADD COLUMN apple_refresh TEXT;
