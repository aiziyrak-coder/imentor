from django.contrib.auth.models import Group, User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


@override_settings(SECURE_SSL_REDIRECT=False, ALLOW_LEGACY_PREPARED_CONTENT_API=True)
class PreparedContentApiTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()

    def _register_user(self, phone: str, password: str, role: str = 'hodim', **extra) -> dict:
        payload = {
            'phone_digits': phone,
            'password': password,
            'role': role,
            'register': True,
            **extra,
        }
        resp = self.client.post('/api/v1/auth/local-login/', payload, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def _login_user(self, phone: str, password: str, **extra) -> dict:
        payload = {'phone_digits': phone, 'password': password, **extra}
        resp = self.client.post('/api/v1/auth/local-login/', payload, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def _ensure_admin_user(self, phone: str = '998901110001', password: str = 'AdminDemo123') -> dict:
        user, created = User.objects.get_or_create(
            username=phone,
            defaults={'first_name': 'Admin', 'last_name': 'Demo'},
        )
        if created or not user.has_usable_password():
            user.set_password(password)
            user.save(update_fields=['password'])
        group, _ = Group.objects.get_or_create(name='admin')
        user.groups.add(group)
        return self._login_user(phone, password)

    def test_create_and_get_latest_prepared_content(self):
        payload = {
            'owner_key': '998901112233',
            'kind': 'lecture',
            'topic': "Yurak yetishmovchiligi",
            'topic_norm': "yurak yetishmovchiligi",
            'payload': {'content': 'demo'},
        }
        create_resp = self.client.post('/api/prepared-content/', payload, format='json')
        self.assertEqual(create_resp.status_code, 201)

        get_resp = self.client.get(
            '/api/prepared-content/',
            {
                'owner_key': '998901112233',
                'kind': 'lecture',
                'topic_norm': 'yurak yetishmovchiligi',
            },
        )
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()['kind'], 'lecture')

    def test_get_requires_query_params(self):
        resp = self.client.get('/api/prepared-content/')
        self.assertEqual(resp.status_code, 400)

    def test_get_without_existing_record_returns_empty_payload(self):
        resp = self.client.get(
            '/api/prepared-content/',
            {
                'owner_key': '998901112233',
                'kind': 'case',
                'topic_norm': 'unknown-topic',
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get('payload'), None)

    def test_v1_requires_jwt(self):
        resp = self.client.get('/api/v1/prepared-content/')
        self.assertEqual(resp.status_code, 401)

    @override_settings(ALLOW_LEGACY_PREPARED_CONTENT_API=False)
    def test_legacy_api_can_be_disabled(self):
        resp = self.client.get('/api/prepared-content/')
        self.assertEqual(resp.status_code, 403)

    def test_local_login_and_v1_prepared_content_flow(self):
        Group.objects.get_or_create(name='hodim')
        access = self._register_user(
            '998901112233',
            'StrongPass123',
            first_name='Test',
            last_name='Hodim',
        )['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        create_resp = self.client.post(
            '/api/v1/prepared-content/',
            {
                'kind': 'lecture',
                'topic': 'Bronxial astma',
                'topic_norm': 'bronxial astma',
                'payload': {'content': 'demo'},
            },
            format='json',
        )
        self.assertEqual(create_resp.status_code, 201)
        self.assertEqual(create_resp.json()['owner_key'], '998901112233')

        get_resp = self.client.get(
            '/api/v1/prepared-content/',
            {'kind': 'lecture', 'topic_norm': 'bronxial astma'},
        )
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()['owner_key'], '998901112233')
        self.assertTrue(User.objects.filter(username='998901112233').exists())

        miss_resp = self.client.get(
            '/api/v1/prepared-content/',
            {'kind': 'lecture', 'topic_norm': 'non-existent'},
        )
        self.assertEqual(miss_resp.status_code, 200)
        self.assertEqual(miss_resp.json().get('payload'), None)

    def test_syllabus_list_create_delete_flow(self):
        Group.objects.get_or_create(name='hodim')
        access = self._register_user(
            '998901112233',
            'StrongPass123',
            first_name='Test',
            last_name='Hodim',
        )['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        list0 = self.client.get('/api/v1/syllabuses/')
        self.assertEqual(list0.status_code, 200)
        self.assertEqual(list0.json(), [])

        create = self.client.post(
            '/api/v1/syllabuses/',
            {
                'external_id': 'local_syl_1',
                'file_name': 'demo.pdf',
                'topics': [
                    {'id': 'M1', 'title': 'Tema 1', 'type': 'lecture'},
                ],
            },
            format='json',
        )
        self.assertEqual(create.status_code, 201)
        sid = create.json()['id']

        list1 = self.client.get('/api/v1/syllabuses/')
        self.assertEqual(list1.status_code, 200)
        self.assertEqual(len(list1.json()), 1)

        del_resp = self.client.delete(f'/api/v1/syllabuses/{sid}/')
        self.assertEqual(del_resp.status_code, 204)

        list2 = self.client.get('/api/v1/syllabuses/')
        self.assertEqual(list2.json(), [])

    def test_live_test_session_public_qr_flow(self):
        Group.objects.get_or_create(name='hodim')
        access = self._register_user(
            '998901112233',
            'StrongPass123',
            first_name='Test',
            last_name='Hodim',
        )['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        q = {
            'question': 'Clinical vignette text here.',
            'options': ['A opt', 'B opt', 'C opt', 'D opt', 'E opt'],
            'correctOptionIndex': 2,
            'explanation': 'Because clinical reasoning.',
        }
        up = self.client.post(
            '/api/v1/live-tests/',
            {
                'session_key': 'lts_qr_demo_1',
                'topic': 'Demo mavzu',
                'questions': [q],
            },
            format='json',
        )
        self.assertEqual(up.status_code, 200)

        self.client.credentials()
        pub = self.client.get('/api/v1/live-tests/lts_qr_demo_1/')
        self.assertEqual(pub.status_code, 200)
        self.assertEqual(pub.json()['topic'], 'Demo mavzu')

        sub = self.client.post(
            '/api/v1/live-tests/lts_qr_demo_1/submissions/',
            {
                'first_name': 'Ali',
                'last_name': 'Valiyev',
                'answers': [2],
            },
            format='json',
        )
        self.assertEqual(sub.status_code, 201)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        lst = self.client.get('/api/v1/live-tests/lts_qr_demo_1/submissions/')
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.json()), 1)
        self.assertEqual(lst.json()[0]['last_name'], 'Valiyev')

    def test_login_preserves_server_role_from_db(self):
        Group.objects.get_or_create(name='hodim')
        Group.objects.get_or_create(name='startuper')
        phone = '998901119999'
        self._register_user(phone, 'StrongPass123', first_name='Ali', last_name='Valiyev')

        admin_bundle = self._ensure_admin_user()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {admin_bundle["access"]}')
        self.client.post(
            '/api/v1/auth/admin-provision-staff/',
            {
                'phone_digits': phone,
                'password': 'StrongPass123',
                'role': 'startuper',
                'first_name': 'Ali',
                'last_name': 'Valiyev',
            },
            format='json',
        )

        login_resp = self._login_user(phone, 'StrongPass123', role='hodim')
        self.assertEqual(login_resp['role'], 'startuper')

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {login_resp["access"]}')
        apps_resp = self.client.get('/api/v1/startup-applications/')
        self.assertEqual(apps_resp.status_code, 200)
        my_syllabus_resp = self.client.get('/api/v1/course-syllabuses/my/')
        self.assertEqual(my_syllabus_resp.status_code, 403)

    def test_login_rejects_unknown_user_without_register(self):
        resp = self.client.post(
            '/api/v1/auth/local-login/',
            {'phone_digits': '998909999999', 'password': 'StrongPass123'},
            format='json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_admin_provision_staff_creates_and_updates_password(self):
        Group.objects.get_or_create(name='admin')
        Group.objects.get_or_create(name='tarjimon')
        admin_bundle = self._ensure_admin_user()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {admin_bundle["access"]}')

        staff_phone = '998909998877'
        create_resp = self.client.post(
            '/api/v1/auth/admin-provision-staff/',
            {
                'phone_digits': staff_phone,
                'password': 'StaffPass123',
                'role': 'tarjimon',
                'first_name': 'Yangi',
                'last_name': 'Tarjimon',
            },
            format='json',
        )
        self.assertEqual(create_resp.status_code, 201)
        self.assertTrue(create_resp.json()['created'])

        staff_login = self.client.post(
            '/api/v1/auth/local-login/',
            {
                'phone_digits': staff_phone,
                'password': 'StaffPass123',
            },
            format='json',
        )
        self.assertEqual(staff_login.status_code, 200)
        self.assertEqual(staff_login.json()['role'], 'tarjimon')

        update_resp = self.client.post(
            '/api/v1/auth/admin-provision-staff/',
            {
                'phone_digits': staff_phone,
                'password': 'NewPass456',
                'role': 'tarjimon',
                'first_name': 'Yangi',
                'last_name': 'Tarjimon',
            },
            format='json',
        )
        self.assertEqual(update_resp.status_code, 200)
        self.assertFalse(update_resp.json()['created'])

        bad_login = self.client.post(
            '/api/v1/auth/local-login/',
            {
                'phone_digits': staff_phone,
                'password': 'StaffPass123',
                'role': 'tarjimon',
            },
            format='json',
        )
        self.assertEqual(bad_login.status_code, 401)

        good_login = self._login_user(staff_phone, 'NewPass456')
        self.assertEqual(good_login['role'], 'tarjimon')

    def test_change_password_and_deprovision(self):
        Group.objects.get_or_create(name='hodim')
        phone = '998901115555'
        bundle = self._register_user(phone, 'OldPass123', first_name='Test', last_name='User')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {bundle["access"]}')
        change = self.client.post(
            '/api/v1/auth/change-password/',
            {'current_password': 'OldPass123', 'new_password': 'NewPass789'},
            format='json',
        )
        self.assertEqual(change.status_code, 200)
        self._login_user(phone, 'NewPass789')

        admin_bundle = self._ensure_admin_user()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {admin_bundle["access"]}')
        deprov = self.client.post(
            '/api/v1/auth/admin-deprovision-staff/',
            {'phone_digits': phone},
            format='json',
        )
        self.assertEqual(deprov.status_code, 204)
        self.assertFalse(User.objects.filter(username=phone).exists())

    def test_device_pair_status_requires_desktop_secret(self):
        from core.models import DevicePairingSession
        from django.utils import timezone
        from datetime import timedelta

        create = self.client.post('/api/v1/device-pair/create/', {}, format='json')
        self.assertEqual(create.status_code, 201)
        token = create.json()['pairing_token']
        secret = create.json()['desktop_secret']

        legacy_poll = self.client.get(f'/api/v1/device-pair/status/{token}/')
        self.assertEqual(legacy_poll.status_code, 200)
        self.assertEqual(legacy_poll.json()['status'], 'pending')

        wrong_secret = self.client.get(f'/api/v1/device-pair/status/{token}/?secret=wrong-value')
        self.assertEqual(wrong_secret.status_code, 403)

        pending = self.client.get(f'/api/v1/device-pair/status/{token}/?secret={secret}')
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()['status'], 'pending')

        obj = DevicePairingSession.objects.get(pairing_token=token)
        obj.status = DevicePairingSession.STATUS_CONFIRMED
        obj.access_token = 'access-demo'
        obj.refresh_token = 'refresh-demo'
        obj.role = 'hodim'
        obj.owner_key = '998901112233'
        obj.save()

        confirmed = self.client.get(f'/api/v1/device-pair/status/{token}/?secret={secret}')
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json()['access'], 'access-demo')

    def test_staff_avatar_upload_and_login_photo_url(self):
        Group.objects.get_or_create(name='hodim')
        login = self._register_user('998901119999', 'AvatarPass123')
        self.assertEqual(login.get('photo_url'), '')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {login["access"]}')

        from django.core.files.uploadedfile import SimpleUploadedFile

        png = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        upload = self.client.post(
            '/api/v1/auth/me/avatar/',
            {'file': SimpleUploadedFile('avatar.png', png, content_type='image/png')},
            format='multipart',
        )
        self.assertEqual(upload.status_code, 200, upload.content)
        photo_url = upload.json().get('photo_url', '')
        self.assertTrue(photo_url)

        me = self.client.get('/api/v1/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json().get('photo_url'), photo_url)

        relogin = self._login_user('998901119999', 'AvatarPass123')
        self.assertEqual(relogin.get('photo_url'), photo_url)

        delete = self.client.delete('/api/v1/auth/me/avatar/')
        self.assertEqual(delete.status_code, 204)

        relogin_empty = self._login_user('998901119999', 'AvatarPass123')
        self.assertEqual(relogin_empty.get('photo_url'), '')

    def test_staff_avatar_rejects_non_image_magic(self):
        Group.objects.get_or_create(name='hodim')
        login = self._register_user('998901118888', 'AvatarPass123')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {login["access"]}')
        from django.core.files.uploadedfile import SimpleUploadedFile

        fake = SimpleUploadedFile('evil.jpg', b'<?php echo 1; ?>', content_type='image/jpeg')
        resp = self.client.post('/api/v1/auth/me/avatar/', {'file': fake}, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_staff_avatar_url_has_cache_bust(self):
        Group.objects.get_or_create(name='hodim')
        login = self._register_user('998901117777', 'AvatarPass123')
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {login["access"]}')
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = SimpleUploadedFile(
            'avatar.png',
            (
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
                b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f'
                b'\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
            ),
            content_type='image/png',
        )
        upload = self.client.post('/api/v1/auth/me/avatar/', {'file': png}, format='multipart')
        self.assertEqual(upload.status_code, 200, upload.content)
        photo_url = upload.json().get('photo_url', '')
        self.assertIn('v=', photo_url)
