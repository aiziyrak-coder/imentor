from django.contrib.auth.models import Group, User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


@override_settings(SECURE_SSL_REDIRECT=False, ALLOW_LEGACY_PREPARED_CONTENT_API=True)
class PreparedContentApiTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()

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
        login_resp = self.client.post(
            '/api/v1/auth/local-login/',
            {
                'phone_digits': '998901112233',
                'password': 'StrongPass123',
                'role': 'hodim',
                'first_name': 'Test',
                'last_name': 'Hodim',
            },
            format='json',
        )
        self.assertEqual(login_resp.status_code, 200)
        access = login_resp.json()['access']
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
        login_resp = self.client.post(
            '/api/v1/auth/local-login/',
            {
                'phone_digits': '998901112233',
                'password': 'StrongPass123',
                'role': 'hodim',
                'first_name': 'Test',
                'last_name': 'Hodim',
            },
            format='json',
        )
        self.assertEqual(login_resp.status_code, 200)
        access = login_resp.json()['access']
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
        login_resp = self.client.post(
            '/api/v1/auth/local-login/',
            {
                'phone_digits': '998901112233',
                'password': 'StrongPass123',
                'role': 'hodim',
                'first_name': 'Test',
                'last_name': 'Hodim',
            },
            format='json',
        )
        self.assertEqual(login_resp.status_code, 200)
        access = login_resp.json()['access']
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
